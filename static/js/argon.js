(() => {
  const root = document.documentElement;
  const nav = document.getElementById('site-nav');
  const menu = document.getElementById('nav-links');
  const menuButton = document.getElementById('nav-toggle');
  const themeButton = document.getElementById('theme-toggle');
  const progress = document.getElementById('reading-progress');
  const toTop = document.getElementById('back-to-top');
  const savedTheme = localStorage.getItem('blog-theme');
  const heroBackgrounds = [...document.querySelectorAll('.hero-background')];

  if (savedTheme) root.dataset.theme = savedTheme;

  const syncGiscusTheme = (theme) => {
    const frame = document.querySelector('iframe.giscus-frame');
    if (frame) frame.contentWindow.postMessage({ giscus: { setConfig: { theme } } }, 'https://giscus.app');
  };

  themeButton?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('blog-theme', next);
    syncGiscusTheme(next);
  });

  menuButton?.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    menuButton.setAttribute('aria-expanded', String(open));
  });

  const onScroll = () => {
    const y = window.scrollY;
    nav?.classList.toggle('is-scrolled', y > 32);
    toTop?.classList.toggle('is-visible', y > 600);
    const height = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.transform = `scaleX(${height > 0 ? y / height : 0})`;
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  toTop?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  if (heroBackgrounds.length) {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let currentIndex = Math.floor(Math.random() * heroBackgrounds.length);

    const loadBackground = (index) => new Promise((resolve) => {
      const background = heroBackgrounds[index];
      if (background.dataset.loaded === 'true') {
        resolve(true);
        return;
      }

      const image = new Image();
      image.onload = () => {
        background.style.backgroundImage = `url("${background.dataset.heroSrc}")`;
        background.dataset.loaded = 'true';
        resolve(true);
      };
      image.onerror = () => resolve(false);
      image.src = background.dataset.heroSrc;
    });

    const nextIndex = () => (currentIndex + 1) % heroBackgrounds.length;
    const preloadNext = () => { loadBackground(nextIndex()); };
    const show = async (index) => {
      if (!await loadBackground(index)) return false;
      heroBackgrounds.forEach((background, backgroundIndex) => {
        background.classList.toggle('is-active', backgroundIndex === index);
      });
      currentIndex = index;
      preloadNext();
      return true;
    };

    show(currentIndex).then((shown) => {
      if (!shown || reducedMotion || heroBackgrounds.length < 2) return;
      window.setInterval(() => { show(nextIndex()); }, 10000);
    });
  }

  onScroll();
})();
