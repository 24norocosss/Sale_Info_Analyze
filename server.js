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

// ★ API 키 확인
const openai = new OpenAI({ apiKey });

app.post('/scrape', async (req, res) => {
    const { url, mode } = req.body;
    
    const logs = [];
    const startTime = Date.now();
    const log = (msg) => {
        const time = ((Date.now() - startTime) / 1000).toFixed(2) + "s";
        const logLine = `[${time}] ${msg}`;
        console.log(logLine);
        logs.push(logLine);
    };

    log(`🔎 [${mode}] 문맥 맞춤 분석 시작: ${url}`);

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
            const pathSegments = urlObj.pathname.split('/').filter(s => s && !['sale','men','women','shop','en-kr','exhibitions','store','event','category-collection','promotion'].includes(s.toLowerCase()));
            const potentialBrand = pathSegments[pathSegments.length - 1] || urlObj.hostname.split('.')[1];
            if (potentialBrand) extractedBrand = potentialBrand.split('?')[0].replace(/-/g, ' ').toUpperCase();
        } catch (e) { log("⚠️ 브랜드명 추출 실패"); }

        // 2. 페이지 이동 & 스크롤
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) { log(`⚠️ 페이지 로딩 지연 (진행함)`); }
        
        if (mode === 'overseas') {
            log(`⬇️ [해외] 깊은 스크롤 진행`);
            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 400;
                    const timer = setInterval(() => {
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= 3000) { clearInterval(timer); resolve(); }
                    }, 100);
                });
            });
        } else {
            log(`⬇️ [국내] 배너 확보를 위한 스크롤`);
            await page.evaluate(async () => {
                window.scrollBy(0, 1000);
                await new Promise(r => setTimeout(r, 800));
                window.scrollTo(0, 0); 
            });
        }
        await page.waitForTimeout(1000);

        // 3. 데이터 추출 (안전장치 포함)
        const extractedContent = await page.evaluate(async ({ currentMode }) => {
            
            if (currentMode === 'domestic') {
                let cutoffY = 10000;
                let foundGrid = false;

                // [전략 1] 상품 그리드 감지
                const containers = document.querySelectorAll('div, ul, section, main');
                const priceRegex = /[0-9,]+(원|%|krw)/i;

                for (const container of containers) {
                    if (foundGrid) break;
                    
                    const children = Array.from(container.children);
                    if (children.length < 2) continue;

                    let productLikeCount = 0;
                    
                    for (const child of children) {
                        if (child.offsetHeight > 800) continue; 
                        
                        const text = (child.innerText || "").trim();
                        const hasImg = child.querySelector('img');
                        const hasPrice = priceRegex.test(text);

                        if (hasImg && hasPrice) {
                            productLikeCount++;
                        }
                    }

                    if (productLikeCount >= 3) {
                        const rect = container.getBoundingClientRect();
                        if (rect.top > 300) { 
                            cutoffY = rect.top;
                            foundGrid = true;
                        }
                    }
                }

                // [전략 2] 필터 바 감지
                if (!foundGrid) {
                    const filterKeywords = ['추천순', '신상품순', '판매인기순', '낮은가격순', '할인율순', '랭킹순', '인기순', '전체상품', '총 0개', '개의 상품'];
                    const allElements = document.body.getElementsByTagName("*");
                    
                    for (let el of allElements) {
                        const rawText = el.innerText || "";
                        if (rawText.length < 50 && el.offsetHeight > 0) {
                            const text = rawText.replace(/\s/g, ''); 
                            if (filterKeywords.some(kw => text.includes(kw))) {
                                const rect = el.getBoundingClientRect();
                                if (rect.top > 200) {
                                    cutoffY = rect.top;
                                    foundGrid = true;
                                    break;
                                }
                            }
                        }
                    }
                }

                // [가위질 실행]
                const safeCutoff = foundGrid ? cutoffY : 5000;
                const allBodyEls = document.body.getElementsByTagName("*");
                for (let i = allBodyEls.length - 1; i >= 0; i--) {
                    const el = allBodyEls[i];
                    const rect = el.getBoundingClientRect();
                    if (rect.top > safeCutoff) {
                        el.remove();
                    }
                }
                document.querySelectorAll('footer, .footer').forEach(e => e.remove());
            }

            // --- 공통 데이터 추출 ---
            const getMeta = (prop) => document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.content || "";
            const metaTitle = getMeta('og:title') || document.title;
            const metaDesc = getMeta('og:description') || getMeta('description'); 
            const realTitle = (metaTitle || "").split('|')[0].trim();

            let finalProducts = [];
            let foundCount = 0;

            if (currentMode === 'overseas') {
                const allElements = Array.from(document.querySelectorAll('div, li, article, a'));
                const candidateCards = allElements.filter(el => {
                    const txt = el.innerText || ""; 
                    if (txt.length > 400 || txt.length < 10) return false;
                    const hasPrice = /[\$₩€£¥]|USD|KRW|JPY|EUR/.test(txt);
                    const hasImage = el.querySelector('img');
                    const isVisible = el.offsetWidth > 0 && el.offsetHeight > 0;
                    return hasPrice && hasImage && isVisible;
                });

                const uniqueCards = [];
                const seenText = new Set();
                candidateCards.forEach(card => {
                    const txt = (card.innerText || "").trim();
                    if (!seenText.has(txt)) { seenText.add(txt); uniqueCards.push(card); }
                });

                const targetCards = uniqueCards.slice(0, 30);
                const products = [];

                targetCards.forEach(el => {
                    const pricePattern = /([$€£¥₩]\s*[0-9,]+(\.[0-9]{1,2})?)|([0-9,]+(\.[0-9]{1,2})?\s*(?:원|KRW|USD|EUR|JPY))/gi;
                    const fullText = el.innerText || ""; 
                    const foundPrices = fullText.match(pricePattern);

                    if (foundPrices && foundPrices.length > 0) {
                        let textOnly = fullText;
                        foundPrices.forEach(p => { textOnly = textOnly.replace(p, ''); });
                        const textLines = textOnly.split('\n').map(t => t.trim()).filter(t => t.length > 1);
                        const bName = textLines[0] || "BRAND";
                        const pName = textLines[1] || textLines[0] || "Item Name";

                        let sPrice = foundPrices[0];
                        let oPrice = "";

                        if (foundPrices.length >= 2) {
                            const nums = foundPrices.map(p => parseFloat(p.replace(/[^0-9.]/g, '')));
                            if (nums[0] > nums[1]) { oPrice = foundPrices[0]; sPrice = foundPrices[1]; } 
                            else { sPrice = foundPrices[0]; oPrice = foundPrices[1]; }
                        }

                        let disc = 0;
                        const sVal = parseFloat(sPrice.replace(/[^0-9.]/g, ''));
                        const oVal = parseFloat((oPrice || sPrice).replace(/[^0-9.]/g, ''));
                        if (oVal > sVal && oVal > 0) disc = Math.round(((oVal - sVal) / oVal) * 100);

                        if (sVal > 0) {
                            products.push({
                                brand: bName,
                                name: pName,
                                salePrice: sPrice,
                                originalPrice: oPrice,
                                discount: disc
                            });
                        }
                    }
                });

                foundCount = products.length;
                finalProducts = products.length > 0 ? products.sort(() => 0.5 - Math.random()).slice(0, 2) : [];
                candidateCards.forEach(el => el.remove());
            }

            const noise = ['nav', 'header', 'script', 'style', 'iframe', 'noscript', 'svg', 'button', 'form', 'input'];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            // 이미지 필터 (너무 작은 건 아이콘)
            const images = Array.from(document.querySelectorAll('img[alt]'));
            const altTexts = images.filter(img => {
                if ((img.naturalWidth > 0 && img.naturalWidth < 50) || (img.offsetHeight > 0 && img.offsetHeight < 50)) return false;
                return true;
            }).map(img => img.getAttribute('alt') || "").filter(t => t.length > 5).join(' ');

            const bodyText = (document.body.innerText || "").substring(0, 3000); 

            const combinedText = `
                [Page Title]: ${realTitle}
                [Meta Description]: ${metaDesc}
                [Image Alt Texts]: ${altTexts}
                [Main Content]: ${bodyText}
            `;
            
            return {
                realTitle: realTitle,
                metaDesc: metaDesc,
                altTexts: altTexts,
                text: combinedText,
                products: finalProducts,
                count: foundCount
            };
        }, { currentMode: mode });

        log(`📝 [${mode}] 데이터 추출 완료 (${extractedContent.text.length}자)`);
        
        // 4. AI 분석 (프롬프트 대폭 강화: 문맥 파악)
        const systemPrompt = `
            너는 최고의 이커머스 세일 정보 분석가야. 
            주어진 텍스트는 쇼핑몰 기획전 페이지의 '상단 배너 및 메타 정보'야.

            [분석 목표]
            1. '세일 기간' (duration): 날짜(MM.DD)나 '기간한정', '단 X일' 등을 찾아. 없으면 "재고 소진 시까지".
            2. '혜택' (benefits): 페이지의 '핵심 테마'에 맞는 혜택 3~5개를 요약해.

            [⚠️ 문맥 판단 규칙 (Context Logic) ⚠️]
            - 너는 'Page Title'과 'Benefits'의 연관성을 판단해야 해.
            
            [규칙 1: 불청객 차단]
            - 만약 Page Title이 '설날 세일', '시즌 오프', '주말 특가' 등인데, 
              내용에 '신규회원 쿠폰', '앱 다운로드', '첫구매 혜택' 같은 상시 배너 내용이 있다면?
              -> **무시해.** (이건 페이지의 주제가 아님)

            [규칙 2: 주인공 대우]
            - 만약 Page Title 자체가 '신규회원 이벤트', '웰컴 혜택', '첫만남 기획전' 이라면?
              -> **'신규회원 쿠폰', '첫구매 혜택'이 핵심이야. 반드시 포함해.**

            [요약]
            - 페이지의 제목(주제)과 일치하는 혜택을 최우선으로 뽑아라.
            - GNB(상단바)에 항상 떠있는 광고성 멘트는 주제와 맞지 않으면 과감히 버려라.

            응답 형식 JSON: {"duration": "...", "benefits": ["...", "..."]}
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

        let finalTitle = aiResponse.title || extractedBrand;
        if (extractedContent.realTitle && extractedContent.realTitle.length > 1) {
            finalTitle = extractedContent.realTitle;
        }

        const responseData = {
            title: (mode === 'overseas') ? extractedBrand : finalTitle,
            top_deals: (mode === 'overseas') ? (extractedContent.products || []) : [],
            duration: aiResponse.duration,
            benefits: aiResponse.benefits,
            platform: (mode === 'overseas') ? "OVERSEAS" : "DOMESTIC",
            logo: logo,
            debug_logs: logs,
            debug_sources: {
                meta_description: extractedContent.metaDesc,
                page_title: extractedContent.realTitle,
                alt_texts_preview: extractedContent.altTexts.substring(0, 100) + "..."
            }
        };

        log(`📤 응답 전송 완료`);
        res.json(responseData);

    } catch (error) {
        console.error("❌ 서버 에러:", error);
        log(`❌ 에러 발생: ${error.message}`);
        res.status(500).json({ error: "분석 실패", debug_logs: logs });
    } finally {
        if (browser) await browser.close();
    }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 서버 실행 중: http://localhost:${PORT}`));