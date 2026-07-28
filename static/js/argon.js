(() => {
  const root = document.documentElement;
  const nav = document.getElementById('site-nav');
  const menu = document.getElementById('nav-links');
  const menuButton = document.getElementById('nav-toggle');
  const themeButton = document.getElementById('theme-toggle');
  const progress = document.getElementById('reading-progress');
  const toTop = document.getElementById('back-to-top');
  const savedTheme = localStorage.getItem('blog-theme');

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
  onScroll();
})();
