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

    log(`🔎 [${mode}] 정밀 타격 분석 시작: ${url}`);

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

        // 2. 페이지 이동
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) { log(`⚠️ 페이지 로딩 지연 (진행함)`); }
        
        // 스크롤 (전체 구조 파악을 위해 적당히 끝까지 훑음)
        if (mode === 'overseas') {
            await page.evaluate(async () => { /* 해외 모드 기존 유지 */ });
        } else {
            log(`⬇️ [국내] 전체 구조 파악을 위한 스크롤`);
            await page.evaluate(async () => {
                // 페이지 전체를 빠르게 훑어서 Lazy Load 이미지를 깨움
                const totalHeight = document.body.scrollHeight;
                for(let i=0; i<totalHeight; i+=800) {
                    window.scrollTo(0, i);
                    await new Promise(r => setTimeout(r, 50)); // 아주 빠르게
                }
                window.scrollTo(0, 0); 
            });
        }
        await page.waitForTimeout(1000);

        // 3. 데이터 추출 (정밀 선별 로직 적용)
        const extractedContent = await page.evaluate(async ({ currentMode }) => {
            
            // [New] 로고 추출
            const getLogoUrl = () => {
                const linkTags = ['link[rel="apple-touch-icon"]', 'link[rel="icon"]', 'link[rel="shortcut icon"]'];
                for (let selector of linkTags) {
                    const el = document.querySelector(selector);
                    if (el && el.href) return el.href;
                }
                return "";
            };
            const directLogo = getLogoUrl();

            // [국내 모드] "그리드만" 콕 집어서 제거 (Selective Removal)
            if (currentMode === 'domestic') {
                const containers = document.querySelectorAll('div, ul, section, main, article');
                const priceRegex = /[0-9,]+(원|%|krw)/i;

                containers.forEach(container => {
                    // 이미 삭제된 요소면 패스
                    if (!container.isConnected) return;

                    const children = Array.from(container.children);
                    if (children.length < 2) return; // 자식이 너무 적으면 그리드 아님

                    let productLikeCount = 0;
                    let totalCount = 0;

                    for (const child of children) {
                        // 너무 큰 요소(배너)는 카운트 제외
                        if (child.offsetHeight > 600) continue; 
                        
                        totalCount++;
                        const text = (child.innerText || "").trim();
                        const hasImg = child.querySelector('img');
                        const hasPrice = priceRegex.test(text);

                        // 이미지와 가격표가 동시에 있으면 상품 카드일 확률 높음
                        if (hasImg && hasPrice) {
                            productLikeCount++;
                        }
                    }

                    // 자식 요소 중 50% 이상이 상품 카드처럼 생겼고, 개수가 3개 이상이면?
                    // -> 이건 "상품 리스트 컨테이너"다!
                    if (productLikeCount >= 3 && (productLikeCount / totalCount) > 0.5) {
                        // [핵심] 그냥 삭제하지 말고, "이 자리는 상품 리스트였습니다" 흔적만 남김 (디버깅용)
                        // container.style.display = 'none'; // 혹은 remove()
                        container.remove();
                    }
                });
                
                // 필터 바 제거
                const filterKeywords = ['추천순', '신상품순', '판매인기순', '낮은가격순', '할인율순', '랭킹순', '인기순', '전체상품'];
                const allElements = document.body.getElementsByTagName("*");
                for (let el of allElements) {
                    const text = (el.innerText || "").replace(/\s/g, '');
                    if (el.offsetHeight > 0 && el.offsetHeight < 100 && filterKeywords.some(kw => text.includes(kw))) {
                         el.remove();
                    }
                }

                // 푸터 제거
                document.querySelectorAll('footer, .footer, #footer').forEach(e => e.remove());
            }

            // --- 공통 데이터 추출 ---
            const getMeta = (prop) => document.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.content || "";
            const metaTitle = document.querySelector('meta[property="og:title"]')?.content || document.title;
            const metaDesc = getMeta('og:description') || getMeta('description'); 
            const realTitle = (metaTitle || "").split('|')[0].trim();

            let finalProducts = [];
            let foundCount = 0;

            // [해외 모드 유지]
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

            // 노이즈 제거
            const noise = ['nav', 'header', 'script', 'style', 'iframe', 'noscript', 'svg', 'button', 'form', 'input'];
            noise.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));

            // [기간 추출 정밀화] 상단 이미지 vs 일반 이미지 분리
            const allImages = Array.from(document.querySelectorAll('img[alt]'));
            
            // 상단 이미지 (Y좌표 0~1000px 안에 있는 큰 이미지들)
            const topBanners = allImages.filter(img => {
                const rect = img.getBoundingClientRect();
                // 화면 상단에 있고, 높이가 어느 정도 있는(50px 이상) 큰 이미지
                return rect.top < 1000 && img.naturalHeight > 50 && img.naturalWidth > 200;
            }).map(img => img.getAttribute('alt') || "").filter(t => t.length > 2);

            // 나머지 이미지들
            const otherAltTexts = allImages.map(img => img.getAttribute('alt') || "").filter(t => t.length > 5);

            const bodyText = (document.body.innerText || "").substring(0, 4000); 

            const combinedText = `
                [Page Title]: ${realTitle}
                [Meta Description]: ${metaDesc}
                
                [★ Priority Info - Top Banners (Dates often here)]: 
                ${topBanners.join(' / ')}

                [Other Image Alt Texts]: 
                ${otherAltTexts.join(' ')}

                [Main Content Text]: 
                ${bodyText}
            `;
            
            return {
                realTitle: realTitle,
                metaDesc: metaDesc,
                topBanners: topBanners, // 로그용
                text: combinedText,
                products: finalProducts,
                count: foundCount,
                directLogo: directLogo
            };
        }, { currentMode: mode });

        log(`📝 [${mode}] 데이터 추출 완료 (${extractedContent.text.length}자)`);
        log(`🗓️ 상단 배너 텍스트 감지: ${extractedContent.topBanners.join(', ').substring(0, 100)}...`);
        
        // 4. AI 분석
        const systemPrompt = `
            너는 최고의 이커머스 세일 정보 분석가야.
            
            [분석 목표]
            1. '세일 기간' (duration): 
               - **[★ Priority Info]** 섹션에 있는 텍스트를 최우선으로 분석해.
               - 날짜 형식(MM.DD, YYYY.MM.DD)이나 '단 X일', '~까지'를 찾아.
               - 기간이 명시되지 않았다면 "재고 소진 시까지".
            
            2. '혜택' (benefits): 
               - 기획전의 핵심 테마 혜택 3~5개 요약.
            
            [문맥 판단 규칙]
            - Page Title과 관계없는 상시 광고(신규회원, 앱다운)는 무시.
            - Page Title이 '신규회원 이벤트'라면 포함.

            응답 한국어로 JSON 형식: {"duration": "...", "benefits": ["...", "..."]}
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
        
        const googleLogo = `https://www.google.com/s2/favicons?sz=128&domain=${new URL(url).hostname}`;
        const finalLogo = (extractedContent.directLogo && extractedContent.directLogo.length > 0) 
                          ? extractedContent.directLogo 
                          : googleLogo;

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
            logo: finalLogo,
            debug_logs: logs,
            debug_sources: {
                top_banner_alts: extractedContent.topBanners.join(', '),
                meta_description: extractedContent.metaDesc,
                page_title: extractedContent.realTitle,
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