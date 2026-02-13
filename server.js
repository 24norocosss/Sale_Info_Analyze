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
    const { url, targetBrand, mode } = req.body;
    let browser;

    try {
        browser = await chromium.launch({ headless: true });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        console.log(`🌐 페이지 접속 중: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); // 페이지 로딩 완료까지 대기
        await page.waitForTimeout(6000); // 동적 콘텐츠 로딩을 위해 넉넉히 대기

        const finalUrl = page.url();
        const urlObj = new URL(finalUrl);
        const domain = urlObj.hostname.replace('www.', '');
        
        const hostParts = domain.split('.');
        let detectedPlatform = "쇼핑몰";
        if (hostParts.length >= 2) {
            const isShortTld = hostParts[hostParts.length - 1].length <= 2;
            const index = isShortTld ? hostParts.length - 3 : hostParts.length - 2;
            detectedPlatform = (hostParts[index] || hostParts[0]).toUpperCase();
        }

        console.log(`📍 분석 중: ${domain} (감지된 플랫폼: ${detectedPlatform})`);

        // 핵심: 해외 모드일 때 제품 정보 + 이미지 URL까지 가져오기 위한 스크래핑 강화
        const extractedContent = await page.evaluate(async ({ brand, currentMode, currentUrl }) => {
            const noise = ['nav', 'footer', 'header', 'script', 'style', 'aside', 'iframe'];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            if (currentMode === 'overseas' && brand) {
                const searchKey = brand.toUpperCase();
                const products = [];

                // SSENSE 같은 사이트는 보통 상품 정보가 특정 클래스에 묶여있음
                // 예시: .browsing-product-item, .product-card 등 (사이트마다 다름, SSENSE 기준)
                const productElements = document.querySelectorAll('.plp-product-list__item'); // SSENSE의 상품 카드 selector
                
                // server.js의 page.evaluate 내부 수정
                for (const el of productElements) {
                    const brandEl = el.querySelector('.plp-product-card__brand');
                    const nameEl = el.querySelector('.plp-product-card__name');
                    const imgEl = el.querySelector('img'); 
                    
                    if (brandEl && brandEl.innerText.toUpperCase().includes(searchKey)) {
                        // server.js의 products.push 전 이미지 주소 가공
                        let finalImgUrl = '';
                        if (imgEl) {
                        let src = imgEl.src || imgEl.getAttribute('data-src') || '';
                        // 상대 경로인 경우를 위해 도메인 체크
                            if (src.startsWith('/')) {
                                src = 'https://www.ssense.com' + src;
                            }
                            // 캐시 방지 및 리다이렉트 방지를 위해 주소가 너무 길거나 이상하면 아예 비우기
                            finalImgUrl = (src.includes('http') && src.length < 500) ? src : '';
                        }

                        products.push({
                            brand: itemBrand,
                            name: nameEl ? nameEl.innerText.trim() : 'Product',
                            imageUrl: finalImgUrl, // 확실한 주소 아니면 빈 값 전달
                            salePrice: salePriceText,
                            originalPrice: originalPriceText,
                            discount: Math.round(discount)
                        });
                    }
                }
                // AI에게 전달할 때는 텍스트와 함께 제품 데이터를 JSON 문자열로 넘김
                return {
                    text: document.body.innerText.substring(0, 8000), // 전체 텍스트도 일부 넘겨 부가정보 추출용
                    products: products 
                };
            }
            
            // 국내 모드 또는 브랜드 미지정 시: 기존 로직과 동일
            const mainArea = document.querySelector('main') || document.querySelector('#__next') || document.querySelector('#contents') || document.body;
            return { text: mainArea.innerText.substring(0, 8000), products: [] }; // 텍스트만 반환
        }, { brand: targetBrand, currentMode: mode, currentUrl: url });

        console.log("🤖 AI 분석 엔진 가동...");

        // AI 프롬프트 구성 (AI가 이미지와 가격 정보를 구조화하도록 유도)
        let systemPrompt = `당신은 쇼핑 분석 전문가입니다. 반드시 JSON 형식으로만 응답하세요.`;
        let userPrompt = "";
        let expectedJsonFormat = {}; // AI에게 원하는 JSON 구조를 명시

        if (mode === 'overseas' && targetBrand) {
            systemPrompt += ` 해외 쇼핑몰(${domain})의 ${targetBrand} 브랜드 세일 정보를 분석하며, 특히 이미지 URL과 가격 정보를 정확히 추출해야 합니다.`;
            userPrompt = `다음은 SSENSE 같은 해외 쇼핑몰에서 추출한 ${targetBrand} 브랜드 제품 정보 및 페이지 텍스트입니다. 가장 할인율이 높은 제품 2개(top_deals)를 찾고, 사이트 전체의 추가 혜택과 세일 기간을 요약해서 JSON으로 응답해주세요.
제품 정보: ${JSON.stringify(extractedContent.products)}
페이지 텍스트: ${extractedContent.text}

응답 형식: {
  "title": "XX 세일",
  "top_deals": [
    {"brand": "브랜드명", "name": "제품명", "originalPrice": "원가", "salePrice": "세일가", "discount": N(할인율%), "imageUrl": "이미지URL"},
    {"brand": "브랜드명", "name": "제품명", "originalPrice": "원가", "salePrice": "세일가", "discount": N(할인율%), "imageUrl": "이미지URL"}
  ],
  "duration": "세일 기간 또는 '재고 소진 시까지'",
  "benefits": ["혜택1", "혜택2"]
}`;
            expectedJsonFormat = {
                title: `${targetBrand} 세일`,
                top_deals: [
                    { brand: "", name: "", originalPrice: "", salePrice: "", discount: 0, imageUrl: "" },
                    { brand: "", name: "", originalPrice: "", salePrice: "", discount: 0, imageUrl: "" }
                ],
                duration: "",
                benefits: [""]
            };
        } else {
            // 국내 모드 프롬프트 (기존과 거의 동일)
            systemPrompt += ` 국내 쇼핑몰 기획전 정보를 분석합니다.`;
            userPrompt = `분석 대상: 국내 쇼핑몰 기획전 (${detectedPlatform})\n텍스트 내용:\n${extractedContent.text}\n\n이 기획전의 메인 제목, 기간, 주요 혜택들을 요약해서 JSON으로 응답해줘. '커뮤니티', '쇼핑' 같은 메뉴 이름은 제목이 아니야.`;
            expectedJsonFormat = {
                title: "",
                duration: "",
                benefits: [""],
                platform: ""
            };
        }

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        
        let logoDomain = domain;
        if (domain.includes('ozip.me') || domain.includes('ohou.se')) logoDomain = 'ohou.se';
        else if (domain.includes('wconcept.co.kr')) logoDomain = 'wconcept.co.kr';
        else if (domain.includes('ssense.com')) logoDomain = 'ssense.com'; // SSENSE 로고도 명확히 지정

        const logo = `https://www.google.com/s2/favicons?sz=128&domain=${logoDomain}`;

        // 최종 응답 객체 구성 (해외 모드일 때 top_deals를 포함하도록)
        if (mode === 'overseas' && targetBrand) {
            res.json({
                title: aiResponse.title || `${targetBrand} 세일`,
                top_deals: aiResponse.top_deals || [],
                duration: aiResponse.duration || "재고 소진 시까지",
                benefits: Array.isArray(aiResponse.benefits) ? aiResponse.benefits : ["세일 상세 페이지 참조"],
                platform: aiResponse.platform || detectedPlatform, // 플랫폼 이름은 그대로
                logo: logo
            });
        } else {
            res.json({
                title: aiResponse.title || "기획전",
                duration: aiResponse.duration || "기간 한정",
                benefits: Array.isArray(aiResponse.benefits) ? aiResponse.benefits : ["상세 페이지 확인"],
                platform: aiResponse.platform || detectedPlatform,
                logo: logo
            });
        }

    } catch (error) {
        console.error("❌ 에러:", error.message);
        res.status(500).json({ error: "분석 실패", detail: error.message });
    } finally {
        if (browser) await browser.close();
    }
});
app.listen(3000, () => console.log('🚀 서버 대기 중 (Port 3000)'));