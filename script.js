// 1. 초기 데이터 설정
let saleData = JSON.parse(localStorage.getItem('mySaleData')) || [];
let currentIndex = 0;
let isDragging = false;
let startX = 0;
let currentMove = 0;

const container = document.getElementById('card-container');
const platformList = document.getElementById('platform-list');
const sideMenu = document.getElementById('side-menu');
const menuOverlay = document.getElementById('menu-overlay');

function saveData() {
    localStorage.setItem('mySaleData', JSON.stringify(saleData));
}

function renderAll() {
    container.innerHTML = '';
    
    if (saleData.length === 0) {
        container.innerHTML = '<div style="color:white; text-align:center; margin-top: 50%;">플랫폼을 추가해주세요.</div>';
    }

    saleData.forEach((data, index) => {
        const card = document.createElement('div');
        const hasTopDeals = data.top_deals && Array.isArray(data.top_deals) && data.top_deals.length > 0;
        
        card.className = `sale-card ${hasTopDeals ? 'overseas-mode' : ''}`;
        card.style.transform = `translateX(${(index - currentIndex) * 100}%)`;
        
        const logoUrl = data.logo || 'https://cdn-icons-png.flaticon.com/512/1162/1162456.png';
        const benefitsList = (data.benefits && data.benefits.length > 0) ? data.benefits : ["특별 혜택 확인"];
        
        // 혜택 태그 생성 (클릭 수정 가능)
        const benefitsHtml = benefitsList.map((b, bIndex) => 
            `<span class="benefit-tag" onclick="makeEditable(this, ${index}, 'benefits', ${bIndex})">${b}</span>`
        ).join('');
        
        const durationText = (data.duration && data.duration !== "undefined") ? data.duration : "";

        if (hasTopDeals) {
            // ✈️ [해외 모드] 디자인 + 수정 기능 통합
            const productsHtml = data.top_deals.map((item, i) => `
                <div class="product-item">
                    <div class="thumb-container">
                        <span class="brand-text" onclick="makeEditable(this, ${index}, 'top_deals', ${i}, 'brand')">${item.brand}</span>
                    </div>
                    
                    <div class="product-name" onclick="makeEditable(this, ${index}, 'top_deals', ${i}, 'name')">${item.name}</div>
                    
                    <div class="final-layout">
                        <div class="final-price-col">
                            <span class="final-sale" onclick="makeEditable(this, ${index}, 'top_deals', ${i}, 'salePrice')">${item.salePrice}</span>
                            <span class="final-original" onclick="makeEditable(this, ${index}, 'top_deals', ${i}, 'originalPrice')">${item.originalPrice}</span>
                        </div>
                        
                        ${item.discount > 0 ? `
                            <div class="final-badge">
                                -<span onclick="makeEditable(this, ${index}, 'top_deals', ${i}, 'discount')">${item.discount}</span>%
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('');

            card.innerHTML = `
                <div class="overseas-inner">
                    <div class="logo-box"><img src="${logoUrl}" class="logo-img"></div>
                    <h1 class="main-title" onclick="makeEditable(this, ${index}, 'title')">${data.title}</h1>
                    
                    <div class="product-grid">
                        ${productsHtml}
                    </div>

                    <div class="benefits-container">${benefitsHtml}</div>
                    ${durationText ? `<p class="period-text" onclick="makeEditable(this, ${index}, 'duration')">${durationText}</p>` : ''}
                </div>
            `;
        } else {
            // 🇰🇷 [국내 모드]
            card.innerHTML = `
                <div class="logo-box"><img src="${logoUrl}" class="logo-img"></div>
                <h1 class="main-title" onclick="makeEditable(this, ${index}, 'title')">${data.title}</h1>
                <div class="benefits-container">${benefitsHtml}</div>
                ${durationText ? `<p class="period-text" onclick="makeEditable(this, ${index}, 'duration')">${durationText}</p>` : ''}
            `;
        }
        
        container.appendChild(card);
    });

    updateSideMenu();
    // [추가] 렌더링이 끝나면 글자 크기 자동 조절 실행!
    // 약간의 딜레이(0초)를 줘야 브라우저가 너비를 계산한 뒤 실행됨
    setTimeout(fitTextToContainer, 0);
}
// ... 사이드 메뉴 및 기타 함수들 ...
// [수정] 사이드 메뉴: 관리용 제목 표시 + 파란색 수정 버튼 추가
function updateSideMenu() {
    platformList.innerHTML = '';
    
    saleData.forEach((data, index) => {
        // 데이터 마이그레이션: 옛날 데이터에 menuTitle이 없으면 title로 채워줌
        if (!data.menuTitle) data.menuTitle = data.title;

        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';
        li.style.alignItems = 'center';
        li.style.padding = '10px 0';
        li.style.borderBottom = '1px solid #eee';

        // 1. 왼쪽 텍스트 (관리용 제목)
        const textSpan = document.createElement('span');
        textSpan.innerText = data.menuTitle; // 이제 title 대신 menuTitle을 사용
        textSpan.style.cursor = 'pointer';
        textSpan.style.fontWeight = index === currentIndex ? 'bold' : 'normal';
        textSpan.style.flex = '1'; // 남은 공간 차지
        textSpan.onclick = () => {
            currentIndex = index;
            closeMenu();
            renderAll();
        };

        // 2. 버튼 그룹 (수정 + 삭제)
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '5px';

        // [New] 파란색 제목 수정 버튼
        const editBtn = document.createElement('button');
        editBtn.innerHTML = '✏️'; // 펜 모양 아이콘
        editBtn.style.cssText = 'background:#007bff; color:white; border:none; padding:5px 8px; border-radius:4px; cursor:pointer; font-size:12px;';
        editBtn.onclick = (e) => {
            e.stopPropagation(); // 메뉴 닫힘 방지
            // 관리용 제목 수정 프롬프트
            const newName = prompt("관리용 제목을 입력하세요:", data.menuTitle);
            if (newName && newName.trim() !== "") {
                saleData[index].menuTitle = newName.trim(); // 변수 분리: menuTitle만 수정됨
                saveData();
                updateSideMenu(); // 메뉴만 다시 그림 (카드는 영향 없음)
            }
        };

        // 빨간색 삭제 버튼
        const delBtn = document.createElement('button');
        delBtn.innerText = '삭제';
        delBtn.style.cssText = 'background:#ff4d4d; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer; font-size:12px;';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteCard(index);
        };

        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(delBtn);

        li.appendChild(textSpan);
        li.appendChild(btnGroup);
        platformList.appendChild(li);
    });
}

function deleteCard(index) {
    if(confirm('정말 삭제하시겠습니까?')) {
        saleData.splice(index, 1);
        if (currentIndex >= saleData.length) currentIndex = Math.max(0, saleData.length - 1);
        saveData();
        renderAll();
    }
}

container.addEventListener('mousedown', (e) => {
    if (sideMenu.classList.contains('active') || e.target.getAttribute('contenteditable') === 'true') return;
    isDragging = true;
    startX = e.pageX;
    const cards = document.querySelectorAll('.sale-card');
    cards.forEach(card => card.style.transition = 'none');
});

window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    currentMove = e.pageX - startX;
    const movePercent = (currentMove / container.offsetWidth) * 100;
    const cards = document.querySelectorAll('.sale-card');
    cards.forEach((card, index) => {
        card.style.transform = `translateX(${(index - currentIndex) * 100 + movePercent}%)`;
    });
});

window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    const threshold = container.offsetWidth * 0.2;
    if (currentMove < -threshold && currentIndex < saleData.length - 1) {
        currentIndex++;
    } else if (currentMove > threshold && currentIndex > 0) {
        currentIndex--;
    }
    const cards = document.querySelectorAll('.sale-card');
    cards.forEach(card => {
        card.style.transition = 'transform 0.5s cubic-bezier(0.215, 0.61, 0.355, 1)';
    });
    currentMove = 0;
    const cardsAfter = document.querySelectorAll('.sale-card');
    cardsAfter.forEach((card, index) => {
        card.style.transform = `translateX(${(index - currentIndex) * 100}%)`;
    });
    updateSideMenu();
});

// [줄바꿈 기능 추가] Shift + Enter 허용 버전
window.makeEditable = function(element, dataIndex, field, subIndex = null, subField = null) {
    if (Math.abs(currentMove) > 5) return;

    element.contentEditable = true;
    element.focus();
    element.classList.add('editing');

    // [핵심] 줄바꿈이 보이려면 CSS가 뒷받침되어야 함
    // 편집 중일 때만 강제로 줄바꿈 허용 스타일 적용
    const originalStyle = element.style.whiteSpace;
    element.style.whiteSpace = "pre-wrap"; 

    element.onblur = function() {
        element.contentEditable = false;
        element.classList.remove('editing');
        
        // 편집 끝나면 원래 스타일로 복구하지 않고, 줄바꿈이 유지되도록 둠
        // (단, 가격 태그 같은 건 한 줄 유지가 나을 수 있으므로 상황 봐서 CSS로 제어)
        
        const newValue = element.innerText; // innerText는 줄바꿈을 \n으로 저장함

        if (field === 'benefits' && subIndex !== null) {
            saleData[dataIndex].benefits[subIndex] = newValue;
        } 
        else if (field === 'top_deals' && subIndex !== null && subField !== null) {
            saleData[dataIndex].top_deals[subIndex][subField] = newValue;
        } 
        else {
            saleData[dataIndex][field] = newValue;
        }

        saveData();
        // [중요 변경점] 
        // 예전에는 제목(title) 바꾸면 updateSideMenu()를 실행해서 목록도 같이 바꿨지만,
        // 이제는 두 변수가 분리되었으므로, 카드 제목을 바꾼다고 목록을 다시 그릴 필요가 없음!
        // if (field === 'title') updateSideMenu();  <-- 이 줄을 삭제함
    };

    element.onkeydown = function(e) {
        if (e.key === 'Enter' && e.shiftKey) return; 
        if (e.key === 'Enter') {
            e.preventDefault();
            element.blur();
        }
    };
};

// [입력 검증] '국내/해외' 단어 체크 기능 포함
// [수정] 데이터 생성 시 관리용 제목(menuTitle) 별도 저장
// [최종] 디버깅 로그 출력 기능이 추가된 addPlatform 함수
window.addPlatform = async function() {
    let apiMode = null;
    while (!apiMode) {
        const modeInput = prompt("분석 모드를 입력하세요 (국내 / 해외):");
        if (modeInput === null) return;
        const trimmedInput = modeInput.trim();
        if (trimmedInput.includes("해외") || trimmedInput.toLowerCase() === "o") {
            apiMode = "overseas";
        } else if (trimmedInput.includes("국내") || trimmedInput.toLowerCase() === "d") {
            apiMode = "domestic";
        } else {
            alert("⚠️ 입력 오류!\n'국내' 또는 '해외'라고 정확히 입력해주세요.");
        }
    }

    const url = prompt(apiMode === "overseas" ? "분석할 해외 브랜드 세일 페이지 URL을 입력하세요:" : "국내 기획전 URL을 입력하세요:");
    if (!url) return;

    alert("분석을 시작합니다... (결과는 F12 콘솔에서도 확인 가능)");
    console.log(`🚀 [Client] 분석 요청 시작: ${url}`);

    try {
        const response = await fetch('http://localhost:3000/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, mode: apiMode })
        });
        if (!response.ok) throw new Error("서버 응답 오류");
        const newData = await response.json();
        
        // ★ [F12 디버깅] 서버에서 받은 로그를 콘솔에 예쁘게 출력
        if (newData.debug_logs) {
            console.groupCollapsed(`🗂️ [분석 리포트] ${newData.title || url}`);
            
            console.group("⏱️ Timeline (서버 작업 로그)");
            newData.debug_logs.forEach(log => console.log(log));
            console.groupEnd();

            if (newData.debug_sources) {
                console.group("🕵️ Extracted Sources (수집된 원본 데이터)");
                console.log("📌 Meta Description:", newData.debug_sources.meta_description || "(없음)");
                console.log("📄 Page Title:", newData.debug_sources.page_title || "(없음)");
                console.log("🖼️ Image Alt Texts:", newData.debug_sources.alt_texts_preview || "(없음)");
                console.groupEnd();
            }

            console.log("✅ Final Data:", newData);
            console.groupEnd();
        }

        if (!newData.benefits || newData.benefits.length === 0) {
            newData.benefits = ["특별 혜택 확인"];
        }
        if (apiMode === "overseas" && (!newData.top_deals || newData.top_deals.length === 0)) {
            alert("⚠️ 제품 정보를 찾지 못했습니다. 국내 포맷으로 표시되거나 URL을 확인해주세요.");
        }

        newData.menuTitle = newData.title; 

        saleData.push(newData);
        currentIndex = saleData.length - 1;
        saveData();
        renderAll();
    } catch (err) {
        console.error(err);
        alert("분석 중 오류가 발생했습니다. (F12 콘솔 확인)");
    }
};

const menuBtn = document.getElementById('menu-trigger');
const closeBtn = document.getElementById('menu-close');
function openMenu() { sideMenu.classList.add('active'); menuOverlay.classList.add('active'); updateSideMenu(); }
function closeMenu() { sideMenu.classList.remove('active'); menuOverlay.classList.remove('active'); }
if (menuBtn) menuBtn.addEventListener('click', openMenu);
if (closeBtn) closeBtn.addEventListener('click', closeMenu);
if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);

// [자동 맞춤 수식] 가격(할인가 + 정가)이 길면 폰트 크기를 줄여서 박스 안에 넣는 함수
// [최종 수정] 텍스트가 넘칠 때만 크기를 줄이는 스마트 함수
function fitTextToContainer() {
    // 할인가와 정가 모두 선택
    const priceTexts = document.querySelectorAll('.final-sale, .final-original');
    
    priceTexts.forEach(el => {
        // 1. 원래 지정된 폰트 크기로 초기화 (스타일 시트 값 복원)
        // 할인가(.final-sale)는 1.1rem, 정가(.final-original)는 0.8rem이 기본값
        // 이렇게 해야 글자가 짧아졌을 때 다시 커질 수 있음
        el.style.fontSize = ''; 
        
        // 현재 적용된 폰트 크기 계산 (px 단위)
        let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
        const minSize = 10; // 최소 10px까지만 줄어듦 (너무 작으면 안 보이니까)

        // 2. [핵심] 텍스트가 박스보다 클 때만 반복해서 줄임
        // scrollWidth(실제 글자 길이) > clientWidth(박스 너비)
        while (el.scrollWidth > el.clientWidth && currentSize > minSize) {
            currentSize -= 0.5; // 0.5px씩 살살 줄임
            el.style.fontSize = currentSize + 'px';
        }
    });
}

renderAll();