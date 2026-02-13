require('dotenv').config(); // .env 파일 설정 불러오기

const apiKey = process.env.FASHION_API_KEY;

console.log("불러온 키:", apiKey);

const express = require('express');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { NodeHtmlMarkdown } = require('node-html-markdown');
const OpenAI = require('openai'); // 최신/옛날 버전 혼용 대응을 위해 수정
const cors = require('cors');

chromium.use(stealth);
const app = express();
app.use(cors());
app.use(express.json());

// 1. OpenAI 초기화 (가장 보수적이고 안전한 방식)
let openai;
try {
    // 최신 버전(v4) 방식 시도
    openai = new OpenAI({ apiKey });
} catch (e) {
    // 안 될 경우 옛날 버전(v3) 방식이나 다른 구조 시도
    const { OpenAI: OpenAIClass } = require('openai');
    openai = new OpenAIClass({ apiKey });
}

app.post('/scrape', async (req, res) => {
    const { url, mode } = req.body;
    console.log(`🔎 분석 시작: ${url} | 모드: ${mode}`);

    let browser; // 에러 발생 시에도 접근할 수 있도록 바깥에 선언
    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        // 1. URL에서 브랜드명 자동 추출 (예: ssense.com/.../alexander-wang -> ALEXANDER WANG)
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/').filter(s => s);
        // 마지막 세그먼트를 가져오되, 쿼리스트링이나 특수문자 제거
        let rawBrand = pathSegments[pathSegments.length - 1] || "BRAND";
        let extractedBrand = rawBrand.split('?')[0].replace(/-/g, ' ').toUpperCase();

        // 2. 페이지 이동 (대기 조건을 'domcontentloaded'로 완화하여 타임아웃 방지)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        
        // 제품이 로딩될 시간을 위해 살짝 대기 (3초)
        await page.waitForTimeout(3000);

        // 3. 브라우저 내부에서 데이터 스크래핑 및 랜덤 추출
        const extractedContent = await page.evaluate(async ({ currentMode }) => {
            const noise = ['nav', 'footer', 'header', 'script', 'style', 'aside', 'iframe'];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            if (currentMode === 'overseas') {
                const products = [];
                // SSENSE 전용 선택자
                const items = document.querySelectorAll('.plp-product-list__item'); 
                
                items.forEach(el => {
                    const bName = el.querySelector('.plp-product-card__brand')?.innerText.trim();
                    const pName = el.querySelector('.plp-product-card__name')?.innerText.trim();
                    const sPrice = el.querySelector('.plp-product-card__price--type-sale')?.innerText.trim();
                    const oPrice = el.querySelector('.plp-product-card__price--type-regular')?.innerText.trim();

                    if (bName && pName && sPrice) {
                        let disc = 0;
                        const s = parseFloat(sPrice.replace(/[^0-9.]/g, ''));
                        const o = parseFloat(oPrice?.replace(/[^0-9.]/g, '') || '0');
                        if (o > s) disc = Math.round(((o - s) / o) * 100);

                        products.push({
                            brand: bName,
                            name: pName,
                            salePrice: sPrice,
                            originalPrice: oPrice || "",
                            discount: disc
                        });
                    }
                });

                // 무작위로 섞어서 2개 추출
                const randomProducts = products.sort(() => 0.5 - Math.random()).slice(0, 2);

                return {
                    text: document.body.innerText.substring(0, 3000),
                    products: randomProducts
                };
            }
            return { text: document.body.innerText.substring(0, 4000), products: [] };
        }, { currentMode: mode });

        // 4. AI 분석 (혜택 및 기간)
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "쇼핑 세일 분석가입니다. JSON으로만 응답하세요." },
                { role: "user", content: `내용: ${extractedContent.text}\n응답형식: {"duration": "기간", "benefits": ["혜택1", "혜택2"]}` }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        
        // 5. 최종 응답 구성 (국내/해외 분기 처리)
        // server.js의 res.json 부분 (하단)

        const domain = urlObj.hostname;
        const logo = `https://www.google.com/s2/favicons?sz=128&domain=${domain}`;

        if (mode === 'overseas') {
            // [해외] URL에서 추출한 브랜드명을 제목으로, 스크래핑된 상품을 top_deals로 전송
            res.json({
                title: extractedBrand, 
                top_deals: extractedContent.products || [], // 여기에 데이터가 없으면 그리드가 안 뜹니다!
                duration: aiResponse.duration || "재고 소진 시까지",
                benefits: aiResponse.benefits || ["추가 할인 혜택"],
                platform: domain.split('.').reverse()[1]?.toUpperCase() || "OVERSEAS",
                logo: logo
            });
        } else {
            // [국내] AI 제목 사용, top_deals는 빈 배열 전송
            res.json({
                title: aiResponse.title || "국내 기획전",
                top_deals: [], 
                duration: aiResponse.duration || "기간 한정",
                benefits: aiResponse.benefits || ["상세 페이지 확인"],
                platform: domain.split('.').reverse()[1]?.toUpperCase() || "DOMESTIC",
                logo: logo
            });
        }
    } catch (error) {
        console.error("❌ 분석 중 에러:", error.message);
        res.status(500).json({ error: "페이지 로딩 시간이 초과되었습니다. 다시 시도해 주세요." });
    } finally {
        if (browser) await browser.close(); // 어떤 상황에서도 브라우저는 닫도록 보장
    }
});
app.listen(3000, () => console.log('🚀 서버 대기 중 (Port 3000)'));