(() => {
  const root = document.documentElement;
  const nav = document.getElementById('site-nav');
  const menu = document.getElementById('nav-links');
  const menuButton = document.getElementById('nav-toggle');
  const themeButton = document.getElementById('theme-toggle');
  const progress = document.getElementById('reading-progress');
  const toTop = document.getElementById('back-to-top');
  const searchButton = document.getElementById('search-toggle');
  const searchDialog = document.getElementById('search-dialog');
  const searchInput = document.getElementById('search-input');
  const searchStatus = document.getElementById('search-status');
  const searchResults = document.getElementById('search-results');
  const savedTheme = localStorage.getItem('blog-theme');
  const heroBackgrounds = [...document.querySelectorAll('.hero-background')];
  const pageTitle = document.title;
  const awayTitle = '要记得回来看看我喵！ฅ^•ﻌ•^ฅ';

  const syncPageTitle = () => {
    document.title = document.hidden ? awayTitle : pageTitle;
  };

  if (savedTheme) root.dataset.theme = savedTheme;

  document.addEventListener('visibilitychange', syncPageTitle);
  window.addEventListener('blur', () => { document.title = awayTitle; });
  window.addEventListener('focus', syncPageTitle);
  syncPageTitle();

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

  if (searchButton && searchDialog && searchInput && searchStatus && searchResults) {
    let searchIndex;
    let previousFocus;
    let requestId = 0;

    const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase();
    const searchableText = (post) => [post.title, post.summary, post.content, ...(post.categories || []), ...(post.tags || [])].join(' ');

    const loadSearchIndex = async () => {
      if (searchIndex) return searchIndex;
      searchStatus.textContent = '正在加载文章索引…';
      const response = await fetch(searchDialog.dataset.indexUrl, { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Search index request failed: ${response.status}`);
      searchIndex = await response.json();
      return searchIndex;
    };

    const appendHighlightedText = (element, value, terms) => {
      const text = String(value || '');
      const normalizedText = normalize(text);
      let cursor = 0;
      const matches = [];

      terms.forEach((term) => {
        let index = normalizedText.indexOf(term);
        while (index !== -1) {
          matches.push([index, index + term.length]);
          index = normalizedText.indexOf(term, index + term.length);
        }
      });

      matches.sort((a, b) => a[0] - b[0]);
      matches.forEach(([start, end]) => {
        if (start < cursor) return;
        element.append(document.createTextNode(text.slice(cursor, start)));
        const mark = document.createElement('mark');
        mark.textContent = text.slice(start, end);
        element.append(mark);
        cursor = end;
      });
      element.append(document.createTextNode(text.slice(cursor)));
    };

    const makeSnippet = (post, terms) => {
      const source = String(post.summary || post.content || '').replace(/\s+/g, ' ').trim();
      const normalizedSource = normalize(source);
      const hit = terms.reduce((best, term) => {
        const index = normalizedSource.indexOf(term);
        return index !== -1 && (best === -1 || index < best) ? index : best;
      }, -1);
      const start = Math.max(0, (hit === -1 ? 0 : hit) - 45);
      const snippet = source.slice(start, start + 150);
      return `${start > 0 ? '…' : ''}${snippet}${start + 150 < source.length ? '…' : ''}`;
    };

    const scorePost = (post, terms, phrase) => {
      const fields = {
        title: normalize(post.title),
        categories: normalize((post.categories || []).join(' ')),
        tags: normalize((post.tags || []).join(' ')),
        summary: normalize(post.summary),
        content: normalize(post.content),
      };
      const combined = Object.values(fields).join(' ');
      if (!terms.every((term) => combined.includes(term))) return 0;

      let score = 0;
      terms.forEach((term) => {
        if (fields.title.includes(term)) score += 20;
        if (fields.tags.includes(term)) score += 12;
        if (fields.categories.includes(term)) score += 10;
        if (fields.summary.includes(term)) score += 6;
        if (fields.content.includes(term)) score += 2;
      });
      if (phrase && fields.title.includes(phrase)) score += 18;
      if (phrase && combined.includes(phrase)) score += 4;
      return score;
    };

    const renderResults = (posts, terms) => {
      searchResults.replaceChildren();
      posts.forEach((post) => {
        const link = document.createElement('a');
        link.className = 'search-result';
        link.href = post.url;

        const heading = document.createElement('h3');
        appendHighlightedText(heading, post.title, terms);

        const meta = document.createElement('div');
        meta.className = 'search-result-meta';
        const tags = (post.tags || []).slice(0, 2).map((tag) => `#${tag}`);
        meta.textContent = [post.date, ...(post.categories || []).slice(0, 2), ...tags].filter(Boolean).join(' · ');

        const excerpt = document.createElement('p');
        appendHighlightedText(excerpt, makeSnippet(post, terms), terms);
        link.append(heading, meta, excerpt);
        searchResults.append(link);
      });
    };

    const runSearch = async () => {
      const currentRequest = ++requestId;
      const query = normalize(searchInput.value).trim();
      const terms = [...new Set(query.split(/\s+/).filter(Boolean))];
      if (!terms.length) {
        searchResults.replaceChildren();
        searchStatus.textContent = '输入关键词开始搜索';
        return;
      }

      try {
        const index = await loadSearchIndex();
        if (currentRequest !== requestId) return;
        const matches = index
          .map((post) => ({ post, score: scorePost(post, terms, query) }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date))
          .slice(0, 20)
          .map((item) => item.post);
        renderResults(matches, terms);
        searchStatus.textContent = matches.length ? `找到 ${matches.length} 篇相关文章` : '没有找到相关文章，试试其他关键词';
      } catch (error) {
        console.error(error);
        searchStatus.textContent = '搜索索引加载失败，请稍后重试';
      }
    };

    const openSearch = () => {
      previousFocus = document.activeElement;
      searchDialog.hidden = false;
      document.body.classList.add('search-open');
      menu.classList.remove('is-open');
      menuButton?.setAttribute('aria-expanded', 'false');
      window.requestAnimationFrame(() => searchInput.focus());
    };

    const closeSearch = () => {
      searchDialog.hidden = true;
      document.body.classList.remove('search-open');
      previousFocus?.focus();
    };

    searchButton.addEventListener('click', openSearch);
    searchDialog.querySelectorAll('[data-search-close]').forEach((button) => button.addEventListener('click', closeSearch));
    searchInput.addEventListener('input', runSearch);
    searchDialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSearch();
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const links = [...searchResults.querySelectorAll('a')];
      if (!links.length) return;
      event.preventDefault();
      const activeIndex = links.indexOf(document.activeElement);
      const nextIndex = event.key === 'ArrowDown'
        ? (activeIndex + 1) % links.length
        : (activeIndex <= 0 ? links.length - 1 : activeIndex - 1);
      links[nextIndex].focus();
    });
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        searchDialog.hidden ? openSearch() : closeSearch();
      }
    });
  }

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
