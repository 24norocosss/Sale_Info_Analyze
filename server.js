require('dotenv').config(); // .env 파일 설정 불러오기

const apiKey = process.env.FASHION_API_KEY;

console.log("불러온 키:", apiKey);

const express = require('express');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const OpenAI = require('openai');
const cors = require('cors');

chromium.use(stealth);
const app = express();
app.use(cors());
app.use(express.json());

// ★ API 키 확인!
const openai = new OpenAI({ apiKey });

app.post('/scrape', async (req, res) => {
    const { url, mode } = req.body;
    console.log(`🔎 [${mode}] 정밀 분석 시작: ${url}`);

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        const page = await context.newPage();

        // 1. 브랜드명 추출
        let extractedBrand = "BRAND";
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s && !['sale','men','women','shop','en-kr'].includes(s.toLowerCase()));
            const potentialBrand = pathSegments[pathSegments.length - 1] || urlObj.hostname.split('.')[1];
            if (potentialBrand) extractedBrand = potentialBrand.split('?')[0].replace(/-/g, ' ').toUpperCase();
        } catch (e) { console.log("브랜드 추출 실패"); }

        // 2. 페이지 이동 & 스크롤
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 400;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= 2500) { clearInterval(timer); resolve(); }
                }, 100);
            });
        });
        await page.waitForTimeout(3000);

        // 3. 만능 데이터 스크래핑 (가격 분리 로직 강화)
        const extractedContent = await page.evaluate(async ({ currentMode }) => {
            const metaTitle = document.querySelector('meta[property="og:title"]')?.content || document.title;
            const realTitle = (metaTitle || "").split('|')[0].trim();

            let finalProducts = [];
            let foundCount = 0;

            if (currentMode === 'overseas') {
                // 후보군 찾기
                const allElements = Array.from(document.querySelectorAll('div, li, article, a'));
                const candidateCards = allElements.filter(el => {
                    if (el.innerText.length > 400 || el.innerText.length < 10) return false;
                    const hasPrice = /[\$₩€£¥]|USD|KRW|JPY|EUR/.test(el.innerText);
                    const hasImage = el.querySelector('img');
                    const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
                    return hasPrice && hasImage && isVisible;
                });

                // 중복 제거
                const uniqueCards = [];
                const seenText = new Set();
                candidateCards.forEach(card => {
                    const txt = card.innerText.trim();
                    if (!seenText.has(txt)) { seenText.add(txt); uniqueCards.push(card); }
                });

                const targetCards = uniqueCards.slice(0, 30);
                const products = [];

                targetCards.forEach(el => {
                    // [핵심] 텍스트 전체에서 가격 패턴만 쏙쏙 뽑아내는 정규표현식
                    // 예: $100, $ 100, 100원, 100 KRW, 100.00 등
                    const pricePattern = /([$€£¥₩]\s*[0-9,]+(\.[0-9]{1,2})?)|([0-9,]+(\.[0-9]{1,2})?\s*(?:원|KRW|USD|EUR|JPY))/gi;
                    
                    const fullText = el.innerText;
                    // match로 찾으면 ["$100", "$200"] 처럼 배열로 나옴
                    const foundPrices = fullText.match(pricePattern);

                    if (foundPrices && foundPrices.length > 0) {
                        // 가격 외의 텍스트(브랜드, 상품명) 찾기
                        // 가격들을 제거한 문자열을 만들어서 줄바꿈으로 나눔
                        let textOnly = fullText;
                        foundPrices.forEach(p => { textOnly = textOnly.replace(p, ''); });
                        
                        const textLines = textOnly.split('\n').map(t => t.trim()).filter(t => t.length > 1);
                        const bName = textLines[0] || "BRAND";
                        const pName = textLines[1] || textLines[0] || "Item Name";

                        let sPrice = foundPrices[0]; // 기본값
                        let oPrice = "";

                        // 가격이 2개 이상 발견되면 비교 시작
                        if (foundPrices.length >= 2) {
                            // 숫자만 추출해서 크기 비교
                            const nums = foundPrices.map(p => parseFloat(p.replace(/[^0-9.]/g, '')));
                            
                            // 0번째와 1번째 가격 비교
                            if (nums[0] > nums[1]) {
                                // 앞쪽이 더 비싸면 (정가 -> 할인가 순서)
                                oPrice = foundPrices[0];
                                sPrice = foundPrices[1];
                            } else {
                                // 뒤쪽이 더 비싸면 (할인가 -> 정가 순서)
                                sPrice = foundPrices[0];
                                oPrice = foundPrices[1];
                            }
                        }

                        // 할인율 계산
                        let disc = 0;
                        const sVal = parseFloat(sPrice.replace(/[^0-9.]/g, ''));
                        const oVal = parseFloat((oPrice || sPrice).replace(/[^0-9.]/g, ''));
                        
                        if (oVal > sVal && oVal > 0) {
                            disc = Math.round(((oVal - sVal) / oVal) * 100);
                        }

                        // 유효성 검사 후 저장
                        if (sVal > 0) {
                            products.push({
                                brand: bName,
                                name: pName,
                                salePrice: sPrice,
                                originalPrice: oPrice, // 정가가 없으면 빈 문자열
                                discount: disc
                            });
                        }
                    }
                });

                foundCount = products.length;
                finalProducts = products.length > 0 ? products.sort(() => 0.5 - Math.random()).slice(0, 2) : [];

                candidateCards.forEach(el => el.remove());
                document.querySelectorAll('[class*="product"], [class*="item"], [class*="grid"]').forEach(e => e.remove());
            }

            const noise = ['nav', 'header', 'footer', 'script', 'style', 'iframe', 'noscript', 'svg', 'button', 'form'];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
            
            return {
                realTitle: realTitle,
                text: document.body.innerText.substring(0, 3000),
                products: finalProducts,
                count: foundCount
            };
        }, { currentMode: mode });

        console.log(`📊 [${extractedBrand}] 찾은 제품 수: ${extractedContent.count}개`);

        const systemPrompt = `
            웹사이트 텍스트에서 '세일 기간'과 '혜택'만 추출해.
            응답은 한국어로 JSON 형식: {"duration": "...", "benefits": ["...", "..."]}
            기간이 없으면 "재고 소진 시까지"로 적어.
        `;
        
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: extractedContent.text }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        const domain = new URL(url).hostname;
        const logo = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;

        if (mode === 'overseas') {
            res.json({
                title: extractedBrand,
                top_deals: extractedContent.products || [], 
                duration: aiResponse.duration,
                benefits: aiResponse.benefits,
                platform: "OVERSEAS",
                logo: logo
            });
        } else {
            const finalTitle = (extractedContent.realTitle && extractedContent.realTitle.length > 2) 
                ? extractedContent.realTitle 
                : (aiResponse.title || "국내 기획전");

            res.json({
                title: finalTitle,
                top_deals: [], 
                duration: aiResponse.duration,
                benefits: aiResponse.benefits,
                platform: "DOMESTIC",
                logo: logo
            });
        }

    } catch (error) {
        console.error("❌ 서버 에러:", error);
        res.status(500).json({ error: "분석 실패" });
    } finally {
        if (browser) await browser.close();
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 서버 실행 중: http://localhost:${PORT}`));