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

        await page.goto(url, { waitUntil: 'commit', timeout: 35000 });
        await page.waitForTimeout(5000); // 해외 사이트는 로딩 시간이 더 필요할 수 있습니다.

        const finalUrl = page.url();
        const urlObj = new URL(finalUrl);
        const domain = urlObj.hostname.replace('www.', '');
        
        // 도메인 기반 플랫폼 이름 자동 추출
        const hostParts = domain.split('.');
        let detectedPlatform = "쇼핑몰";
        if (hostParts.length >= 2) {
            const isShortTld = hostParts[hostParts.length - 1].length <= 2;
            const index = isShortTld ? hostParts.length - 3 : hostParts.length - 2;
            detectedPlatform = (hostParts[index] || hostParts[0]).toUpperCase();
        }

        // [정밀 노이즈 제거 및 텍스트 추출]
        const cleanContext = await page.evaluate(({ brand, currentMode }) => {
            const noise = [
                'header', 'footer', 'nav', 'aside', 'script', 'style', 'iframe',
                '.Header', '.Footer', '[class*="NavigationBar"]', '.commerce-category-navigation'
            ];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            if (currentMode === 'overseas' && brand) {
                // 해외 브랜드 모드: 브랜드 키워드 주변 텍스트 집중 수집
                const bodyText = document.body.innerText;
                const lines = bodyText.split('\n');
                return lines.filter(line => line.toUpperCase().includes(brand.toUpperCase())).join('\n');
            }
            // 국내 기획전 모드: 메인 컨텐츠 영역 우선 추출
            const main = document.querySelector('main') || document.querySelector('#__next') || document.body;
            return main.innerText;
        }, { brand: targetBrand, currentMode: mode });

        console.log(`🤖 AI 분석 모드: ${mode === 'overseas' ? '해외(' + targetBrand + ')' : '국내'}`);
        
        // [AI 프롬프트 강화] - 이 부분이 '세일' 두 글자 에러를 막아줍니다.
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { 
                    role: "system", 
                    content: `당신은 쇼핑 분석 전문가입니다. 반드시 JSON으로 응답하세요.
                    - title: 기획전의 구체적인 제목 (예: "레이첼콕스 24H 특가", "[O!SALE] 기획전")
                    - duration: 이벤트 기간 (예: "21일 08시간 남음", "02.01 ~ 02.15")
                    - benefits: 구체적인 혜택 3가지 이내 (예: "최대 67% 할인", "단독 특가")
                    - platform: 브랜드 또는 쇼핑몰 이름 (예: "오늘의집", "W컨셉", "SSENSE")` 
                },
                { 
                    role: "user", 
                    content: mode === 'overseas' 
                        ? `해외 사이트 ${domain}에서 **${targetBrand}** 제품의 할인 정보를 요약해줘.\n내용:\n${cleanContext.substring(0, 7000)}`
                        : `국내 쇼핑몰 ${detectedPlatform}의 기획전 정보를 분석해줘. '커뮤니티/쇼핑' 같은 메뉴명은 제목이 아니야.\n내용:\n${cleanContext.substring(0, 7000)}` 
                }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        
        // 로고 도메인 보정 (이미지 404 방지)
        let finalLogoDomain = domain;
        if (domain.includes('ozip.me') || domain.includes('ohou.se')) finalLogoDomain = 'ohou.se';
        else if (domain.includes('wconcept')) finalLogoDomain = 'wconcept.co.kr';
        
        const logo = `https://www.google.com/s2/favicons?sz=128&domain=${finalLogoDomain}`;

        res.json({
            title: aiResponse.title || "기획전 제목",
            duration: aiResponse.duration || "기간 한정",
            benefits: Array.isArray(aiResponse.benefits) ? aiResponse.benefits : [],
            platform: aiResponse.platform || detectedPlatform,
            logo: logo
        });

    } catch (error) {
        console.error("❌ 추출 에러 상세:", error.message);
        res.status(500).json({ error: "분석 실패", detail: error.message });
    } finally {
        if (browser) await browser.close();
    }
});
app.listen(3000, () => console.log('🚀 서버 대기 중 (Port 3000)'));