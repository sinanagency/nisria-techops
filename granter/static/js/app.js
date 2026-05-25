// Nisria Grant Finder — Global JS

// Dark mode toggle
(function () {
    const toggle = document.getElementById('darkModeToggle');
    if (!toggle) return;

    const html = document.documentElement;
    const saved = localStorage.getItem('theme');
    if (saved) {
        html.setAttribute('data-bs-theme', saved);
        updateIcon(saved);
    }

    toggle.addEventListener('click', function () {
        const current = html.getAttribute('data-bs-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-bs-theme', next);
        localStorage.setItem('theme', next);
        updateIcon(next);
    });

    function updateIcon(theme) {
        const icon = toggle.querySelector('i');
        if (icon) {
            icon.className = theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
        }
    }
})();

// Search debounce (for AJAX search if needed later)
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// Active nav link
(function () {
    const path = window.location.pathname;
    document.querySelectorAll('.nav-link').forEach(function (link) {
        const href = link.getAttribute('href');
        if (href === '/') {
            if (path === '/') link.classList.add('active');
        } else if (path.startsWith(href)) {
            link.classList.add('active');
        }
    });
})();
