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

// ★ API 키 확인 필수!
const openai = new OpenAI({ apiKey });

app.post('/scrape', async (req, res) => {
    const { url, mode } = req.body;
    console.log(`🔎 [${mode}] 분석 시작: ${url}`);

    let browser;
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            // 일반적인 PC 사용자 환경으로 위장
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 }
        });
        const page = await context.newPage();

        // 1. 브랜드명 추출 (URL 기반, 실패 시 메타태그 사용)
        let extractedBrand = "BRAND";
        try {
            const urlObj = new URL(url);
            const pathSegments = urlObj.pathname.split('/').filter(s => s);
            // URL의 마지막 부분(brand-name)을 가져와서 포맷팅
            const lastSegment = pathSegments[pathSegments.length - 1];
            if (lastSegment) {
                extractedBrand = lastSegment.split('?')[0].replace(/-/g, ' ').toUpperCase();
            }
        } catch (e) { console.log("URL 브랜드 추출 실패"); }

        // 2. 페이지 이동 (대기 시간 넉넉히)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // 스크롤을 내려서 이미지를 로딩시킴 (Lazy Loading 대응)
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 300;
                const timer = setInterval(() => {
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= 1500) { // 적당히 1500px 정도만 스크롤
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        await page.waitForTimeout(2000); // 렌더링 대기

        // 3. 만능 데이터 스크래핑
        const extractedContent = await page.evaluate(async ({ currentMode }) => {
            // (1) 진짜 제목 가져오기
            const metaTitle = document.querySelector('meta[property="og:title"]')?.content 
                            || document.title;
            const realTitle = (metaTitle || "").split('|')[0].trim();

            let finalProducts = [];
            let foundCount = 0;

            if (currentMode === 'overseas') {
                // [만능 전략] 특정 클래스가 아니라 '제품 카드'의 특징을 가진 요소를 찾음
                // 1. ID에 'product'가 들어간 요소 (SSENSE 등)
                // 2. data-test 속성이 'product-card'인 요소
                // 3. class 이름에 'product'나 'item'이 포함되고 + 내부에 가격($/₩)이 있는 요소
                
                let candidateElements = [];
                
                // 전략 A: 명확한 ID나 속성이 있는 경우 (가장 정확)
                const specificItems = Array.from(document.querySelectorAll('[id^="product-"], [data-test="product-card"], .product-tile, .grid-view-item'));
                
                if (specificItems.length > 0) {
                    candidateElements = specificItems;
                } else {
                    // 전략 B: 속성이 없으면 '가격 텍스트'를 포함한 박스를 찾음 (범용)
                    const allDivs = Array.from(document.querySelectorAll('div, li, article'));
                    candidateElements = allDivs.filter(div => {
                        // 너무 큰 박스(페이지 전체)는 제외
                        if (div.innerText.length > 500) return false;
                        // 가격 기호가 포함되어 있어야 함
                        const hasPrice = /[\$₩€£]|USD|KRW/.test(div.innerText);
                        // 이미지가 포함되어 있어야 함
                        const hasImage = div.querySelector('img');
                        return hasPrice && hasImage;
                    });
                }

                // 중복 제거 (부모-자식 관계 등으로 겹칠 수 있음)
                // DOM 트리에서 가장 깊은 요소(실제 카드)만 남기거나, 상위 20개만 추림
                const uniqueItems = [...new Set(candidateElements)].slice(0, 30);

                const products = [];
                uniqueItems.forEach(el => {
                    const fullText = el.innerText.split('\n').filter(t => t.trim().length > 0);
                    
                    // 텍스트 라인 분석
                    // 보통 [브랜드] [상품명] [가격] 순서이거나 [상품명] [가격] 순서
                    if (fullText.length >= 2) {
                        // 가격 찾기 (숫자가 포함되고 화폐단위가 있는 줄)
                        const priceLines = fullText.filter(t => /[0-9]/.test(t) && /[\$₩€£]|USD|KRW/.test(t));
                        
                        if (priceLines.length > 0) {
                            // 상품명과 브랜드 추정 (가격 줄이 아닌 것들 중 가장 위쪽)
                            const textLines = fullText.filter(t => !priceLines.includes(t));
                            const bName = textLines[0] || "BRAND";
                            const pName = textLines[1] || textLines[0] || "Item Name";

                            // 가격 파싱
                            let sPrice = priceLines[0]; // 할인가
                            let oPrice = ""; // 정가

                            if (priceLines.length >= 2) {
                                // 두 개 가격 중 더 작은 것을 할인가로 간주
                                const nums = priceLines.map(p => parseFloat(p.replace(/[^0-9.]/g, '')));
                                if (nums[0] > nums[1]) { oPrice = priceLines[0]; sPrice = priceLines[1]; }
                                else { oPrice = priceLines[1]; sPrice = priceLines[0]; }
                            }

                            // 할인율 계산
                            let disc = 0;
                            const sVal = parseFloat(sPrice.replace(/[^0-9.]/g, ''));
                            const oVal = parseFloat((oPrice || sPrice).replace(/[^0-9.]/g, ''));
                            if (oVal > sVal && oVal > 0) disc = Math.round(((oVal - sVal) / oVal) * 100);

                            // 데이터가 유효하면 추가
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
                    }
                });

                foundCount = products.length;
                // 랜덤 2개 추출
                finalProducts = products.length > 0 ? products.sort(() => 0.5 - Math.random()).slice(0, 2) : [];

                // [중요] 1번 문제 해결: 추출이 끝난 제품 리스트는 화면에서 삭제!
                // 그래야 AI가 가격을 혜택으로 읽지 않음
                candidateElements.forEach(el => el.remove());
                document.querySelectorAll('[id^="product-"], .product-grid, .grid-view').forEach(e => e.remove());
            }

            // (2) 텍스트 추출 (제품이 삭제된 상태)
            // 불필요한 태그 제거
            const noise = ['nav', 'header', 'footer', 'script', 'style', 'iframe', 'noscript', 'svg', 'button'];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
            
            return {
                realTitle: realTitle,
                text: document.body.innerText.substring(0, 3000),
                products: finalProducts,
                count: foundCount
            };
        }, { currentMode: mode });

        console.log(`📊 [${extractedBrand}] 찾은 제품 수: ${extractedContent.count}개`);

        // 4. AI 분석 (혜택/기간)
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

        // 5. 응답
        if (mode === 'overseas') {
            res.json({
                title: extractedBrand, // URL 브랜드명 우선
                top_deals: extractedContent.products || [], 
                duration: aiResponse.duration,
                benefits: aiResponse.benefits,
                platform: "OVERSEAS",
                logo: logo
            });
        } else {
            // 국내는 진짜 제목 우선
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