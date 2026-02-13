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
    // 1. 메인 카드 영역 비우기
    container.innerHTML = '';
    
    // 2. 카드 렌더링 (해외/국내 분기)
    saleData.forEach((data, index) => {
        const card = document.createElement('div');
        card.className = `sale-card ${data.top_deals ? 'overseas-mode' : ''}`;
        
        const defaultLogo = 'https://cdn-icons-png.flaticon.com/512/1162/1162456.png';
        const logoUrl = data.logo || defaultLogo;

        if (data.top_deals && data.top_deals.length > 0) {
            // [해외 모드 HTML]
            card.innerHTML = `
                <div class="overseas-inner">
                    <div class="logo-box">
                        <img src="${logoUrl}" class="logo-img" onerror="this.src='${defaultLogo}'">
                    </div>
                    <div class="product-grid">
                        ${data.top_deals.slice(0, 2).map(item => `
                            <div class="product-item">
                                ${item.discount > 0 ? `<span class="discount-badge">${item.discount}%</span>` : ''}
                                
                                <div class="thumb-container" style="width: 100%; aspect-ratio: 1/1; background: #f4f4f4; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                                    <img src="${item.imageUrl}" 
                                        class="product-thumb" 
                                        style="width: 100%; height: 100%; object-fit: contain;"
                                        onerror="this.onerror=null; this.style.display='none'; this.parentElement.innerHTML='<div style=\'color:#bbb; font-size:11px; font-weight:bold; line-height:1.2;\'>${item.brand}<br>NO IMAGE</div>';">
                                </div>
                                
                                <div class="product-name" style="font-size: 0.75rem; color: #666; margin: 8px 0 4px 0; height: 2.4em; overflow: hidden; line-height: 1.2; width: 100%;">
                                    ${item.name}
                                </div>

                                <div class="price-box">
                                    <span class="sale-price" style="font-size: 0.9rem; font-weight: 800; color:#000;">${item.salePrice}</span>
                                    <span class="original-price" style="font-size: 0.75rem; color: #ddd; text-decoration: line-through; display:block;">${item.originalPrice}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    <div class="benefits-container">
                        ${(data.benefits || []).map(b => `<span class="benefit-tag">${b}</span>`).join('')}
                    </div>
                    <p class="period-text">${data.duration || '재고 소진 시까지'}</p>
                </div>
            `;
        } else {
            // [국내 모드 HTML]
            card.innerHTML = `
                <div class="logo-box">
                    <img src="${logoUrl}" class="logo-img" onerror="this.src='${defaultLogo}'">
                </div>
                <div class="sale-info">
                    <h1 class="main-title" ondblclick="makeEditable(this, ${index}, 'title')">${data.title || data.info || '제목 없음'}</h1>
                    <div class="benefits-container">
                        ${(data.benefits || []).map((b, bi) => `<span class="benefit-tag" ondblclick="makeEditable(this, ${index}, 'benefits', ${bi})">${b}</span>`).join('')}
                    </div>
                    <p class="period-text" ondblclick="makeEditable(this, ${index}, 'duration')">${data.duration || data.period || '기간 정보 없음'}</p>
                </div>
            `;
        }
        
        card.style.transform = `translateX(${(index - currentIndex) * 100}%)`;
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
    // 1. 국내/해외 선택
    const mode = prompt("어떤 사이트를 분석할까요? (국내/해외 중 입력)");
    if (!mode) return;

    let url = "";
    let targetBrand = "";

    if (mode === "국내") {
        url = prompt("기획전 링크를 입력하세요:");
    } else if (mode === "해외") {
        url = prompt("분석할 해외 사이트 세일 페이지 링크:");
        targetBrand = prompt("찾고 싶은 브랜드명은 무엇인가요? (브랜드 명 정확히 입력)");
    } else {
        alert("잘못된 선택입니다.");
        return;
    }

    if (!url) return;

    console.log(`${targetBrand || '기획전'} 분석 시작...`);

    try {
        const response = await fetch('http://localhost:3000/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                url, 
                targetBrand, // 해외 모드일 때만 데이터가 담김
                mode: mode === "1" ? "domestic" : "overseas" 
            })
        });

        if (!response.ok) throw new Error("서버 응답 에러");
        const autoData = await response.json();
        
        saleData.push(autoData);
        saveData();
        renderAll();
        alert("분석 완료!");
    } catch (err) {
        console.error("에러 발생:", err);
        alert("분석에 실패했습니다.");
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