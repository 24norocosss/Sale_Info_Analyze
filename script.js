// 1. 초기 데이터 설정: 로컬 스토리지 확인 후 없으면 기본값 사용
let saleData = JSON.parse(localStorage.getItem('mySaleData')) || [
    { platform: "MUSINSA", info: "시즌 오프 최대 80% 할인", period: "02.01 ~ 02.15" },
    { platform: "29CM", info: "신규 브랜드 입점 15% 쿠폰팩", period: "단 24시간 진행" },
    { platform: "W CONCEPT", info: "프리미엄 브랜드 단독 특가", period: "02.04 ~ 02.10" }
];

let currentIndex = 0;
let isDragging = false;
let startX = 0;
let currentMove = 0;

const container = document.getElementById('card-container');
const platformList = document.getElementById('platform-list');
const sideMenu = document.getElementById('side-menu');
const menuOverlay = document.getElementById('menu-overlay');

// 2. 데이터 저장 및 렌더링 함수
function saveData() {
    localStorage.setItem('mySaleData', JSON.stringify(saleData));
}

function renderAll() {
    container.innerHTML = '';
    
    saleData.forEach((data, index) => {
        const card = document.createElement('div');
        
        // [핵심] top_deals에 데이터가 있으면 무조건 해외 모드 그리드 가동
        const hasTopDeals = data.top_deals && Array.isArray(data.top_deals) && data.top_deals.length > 0;
        card.className = `sale-card ${hasTopDeals ? 'overseas-mode' : ''}`;
        
        const logoUrl = data.logo || 'https://cdn-icons-png.flaticon.com/512/1162/1162456.png';

        if (hasTopDeals) {
            // 🎬 해외 브랜드 전용: 2열 그리드 포맷
            card.innerHTML = `
                <div class="overseas-inner" style="width:100%; display:flex; flex-direction:column; align-items:center;">
                    <div class="logo-box"><img src="${logoUrl}" class="logo-img"></div>
                    
                    <h1 class="main-title" style="margin-bottom: 20px; font-weight:900;">${data.title}</h1>
                    
                    <div class="product-grid" style="display: flex; gap: 15px; width: 100%; justify-content: center; margin-bottom: 25px; padding: 0 15px;">
                        ${data.top_deals.map(item => `
                            <div class="product-item" style="flex: 1; background: #fff; padding: 12px; border-radius: 12px; position: relative; box-shadow: 0 4px 10px rgba(0,0,0,0.03);">
                                <div class="thumb-container" style="width: 100%; aspect-ratio: 1/1; background: #f4f4f4; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
                                    <span style="font-size: 10px; color: #bbb; font-weight: 800; letter-spacing:1px;">${item.brand.toUpperCase()}</span>
                                </div>
                                <div class="product-name" style="font-size: 11px; color: #444; height: 2.4em; overflow: hidden; line-height:1.2; margin-bottom: 8px; font-weight:500;">${item.name}</div>
                                <div class="price-box" style="text-align:center;">
                                    <div style="display:flex; align-items:center; justify-content:center; gap:4px;">
                                        <span class="sale-price" style="font-weight: 900; font-size: 14px; color:#000;">${item.salePrice}</span>
                                        <span class="discount-badge" style="background: #ff4d4d; color: #fff; padding: 2px 5px; border-radius: 4px; font-size: 10px; font-weight:800;">${item.discount}%</span>
                                    </div>
                                    <div class="original-price" style="font-size: 11px; color: #ccc; text-decoration: line-through; margin-top:2px;">${item.originalPrice}</div>
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div class="benefits-container">
                        ${(data.benefits || []).map(b => `<span class="benefit-tag">${b}</span>`).join('')}
                    </div>
                    <p class="period-text" style="margin-top:15px; font-size:12px; color:#999;">${data.duration}</p>
                </div>
            `;
        } else {
            // 🇰🇷 국내 기획전 전용: 단순 포맷
            card.innerHTML = `
                <div class="logo-box"><img src="${logoUrl}" class="logo-img"></div>
                <h1 class="main-title">${data.title}</h1>
                <div class="benefits-container">
                    ${(data.benefits || []).map(b => `<span class="benefit-tag">${b}</span>`).join('')}
                </div>
                <p class="period-text">${data.duration}</p>
            `;
        }
        container.appendChild(card);
    });

    // [중요!] 3. 메뉴 리스트 렌더링 (이 부분이 다시 들어가야 리스트가 보입니다)
    platformList.innerHTML = ''; 
    saleData.forEach((data, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            ${data.platform || '알 수 없음'} 
            <button onclick="deletePlatform(${index})" style="float:right; border:none; background:none; color:#ff4d4d; cursor:pointer; font-weight:bold;">삭제</button>
        `;
        platformList.appendChild(li);
    });
}

// 3. 플랫폼 추가/삭제 기능
window.addPlatform = async function() {
    const modeInput = prompt("국내 또는 해외를 입력하세요:");
    if (!modeInput) return;

    const apiMode = (modeInput === "해외" || modeInput === "oss") ? "overseas" : "domestic";
    const url = prompt("분석할 사이트 URL을 입력하세요:");
    if (!url) return;

    try {
        const response = await fetch('http://localhost:3000/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, mode: apiMode }) // targetBrand 제거
        });

        const data = await response.json();
        saleData.push(data);
        saveData();
        renderAll();
        alert("분석 완료! 카드가 추가되었습니다.");
    } catch (err) {
        alert("분석 실패! 다시 시도해주세요.");
    }
};
window.deletePlatform = function(index) {
    if (confirm(`${saleData[index].platform} 정보를 삭제할까요?`)) {
        saleData.splice(index, 1);
        // 삭제 후 현재 인덱스가 범위를 벗어나면 조정
        if (currentIndex >= saleData.length && currentIndex > 0) currentIndex--;
        saveData();
        renderAll();
    }
};

// 4. 메뉴 제어 로직 (버그 수정판)
function openMenu() {
    sideMenu.classList.add('active');
    menuOverlay.classList.add('active');
}

function closeMenu() {
    sideMenu.classList.remove('active');
    menuOverlay.classList.remove('active');
}

// 메뉴 열기 버튼 (이벤트 전파 방지 적용)
document.getElementById('menu-trigger').onclick = function(e) {
    e.stopPropagation(); 
    openMenu();
};

// 메뉴 닫기 버튼 및 오버레이 클릭
document.getElementById('menu-close').onclick = closeMenu;
menuOverlay.onclick = closeMenu;

// 5. 드래그 슬라이드 로직
container.addEventListener('mousedown', (e) => {
    if (sideMenu.classList.contains('active')) return; // 메뉴 열려있을 땐 드래그 금지
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
});

// 초기 실행
renderAll();

// 텍스트 수정을 가능하게 만드는 함수
window.makeEditable = function(element, dataIndex, field, benefitIndex = null) {
    // 1. 편집 가능 상태로 변경
    element.contentEditable = true;
    element.focus();
    element.classList.add('editing'); // 편집 중임을 알리는 스타일 (선택사항)

    // 2. 엔터를 치거나 포커스를 잃으면 저장
    element.onblur = function() {
        element.contentEditable = false;
        element.classList.remove('editing');
        
        const newValue = element.innerText.trim();

        // 3. 데이터 업데이트
        if (field === 'benefits' && benefitIndex !== null) {
            saleData[dataIndex].benefits[benefitIndex] = newValue;
        } else {
            saleData[dataIndex][field] = newValue;
        }

        saveData(); // 로컬 스토리지에 저장
        console.log(`✅ ${field} 수정 완료:`, newValue);
    };

    // 엔터키 입력 시 강제 blur 처리 (저장)
    element.onkeydown = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            element.blur();
        }
    };
};