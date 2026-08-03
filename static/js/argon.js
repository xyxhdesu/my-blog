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
  const randomButton = document.getElementById('random-toggle');
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

  if (randomButton) {
    const randomStorageKey = 'blog-last-random-post';
    const originalRandomTitle = randomButton.title;

    const randomPost = async () => {
      randomButton.disabled = true;
      randomButton.setAttribute('aria-busy', 'true');
      try {
        const response = await fetch(randomButton.dataset.indexUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Random index request failed: ${response.status}`);
        const posts = await response.json();
        const currentUrl = new URL(window.location.href).pathname.replace(/\/$/, '') || '/';
        const lastUrl = localStorage.getItem(randomStorageKey);
        let candidates = posts.filter((post) => post.url && post.url.replace(/\/$/, '') !== currentUrl);
        if (candidates.length > 1) candidates = candidates.filter((post) => post.url !== lastUrl);
        if (!candidates.length) candidates = posts;
        const choice = candidates[Math.floor(Math.random() * candidates.length)];
        if (!choice?.url) throw new Error('Random index has no posts');
        try {
          localStorage.setItem(randomStorageKey, choice.url);
        } catch (error) {
          console.warn('Random post history could not be saved', error);
        }
        window.location.assign(choice.url);
      } catch (error) {
        console.warn('Random post unavailable', error);
        randomButton.title = '暂时无法随机漫游';
        window.setTimeout(() => { randomButton.title = originalRandomTitle; }, 2500);
      } finally {
        randomButton.disabled = false;
        randomButton.removeAttribute('aria-busy');
      }
    };

    randomButton.addEventListener('click', randomPost);
  }

  const morningReport = document.getElementById('morning-report');

  if (morningReport) {
    const endpoint = morningReport.dataset.endpoint;
    const quoteCount = 6;
    const fallbackAnimeQuotes = [
      { text: '把今天的风收进信封，明天再拆开。', from: '小花的备忘' },
      { text: '星光落在肩上，赶路的人也有了方向。', from: '小花的备忘' },
      { text: '故事还没有结尾，所以现在出发也不算晚。', from: '小花的备忘' },
      { text: '在普通的日子里，也要留一盏灯给自己。', from: '小花的备忘' },
      { text: '把喜欢的事慢慢做好，时间会记得。', from: '小花的备忘' },
      { text: '愿每一次抬头，都能看见值得期待的远方。', from: '小花的备忘' },
    ];

    const normalizeQuotes = (quotes) => {
      const unique = new Set();
      return quotes
        .filter((quote) => quote?.text)
        .map((quote) => ({ text: String(quote.text).trim(), from: String(quote.from || '').trim() }))
        .filter((quote) => quote.text && !unique.has(quote.text) && unique.add(quote.text));
    };

    const getAnimeQuotes = (report) => {
      const cacheKey = `blog-anime-quotes:v1:${report.date || 'latest'}`;
      try {
        const cached = normalizeQuotes(JSON.parse(localStorage.getItem(cacheKey) || '[]'));
        if (cached.length >= quoteCount) return cached.slice(0, quoteCount);
      } catch {
        // A fresh quote set can still be displayed when storage is unavailable.
      }

      const supplied = Array.isArray(report.quotes) ? report.quotes : [report.quote];
      const quotes = normalizeQuotes([...supplied, ...fallbackAnimeQuotes]).slice(0, quoteCount);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(quotes));
      } catch (error) {
        console.warn('Anime quotes could not be cached', error);
      }
      return quotes;
    };

    const startAnimeQuoteCycle = (quote, quotes) => {
      const label = document.createElement('span');
      label.className = 'morning-quote-label';
      label.textContent = '次元语录';
      const text = document.createElement('p');
      const from = document.createElement('footer');
      quote.append(label, text, from);

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        text.textContent = quotes[0].text;
        from.textContent = quotes[0].from ? `—— ${quotes[0].from}` : '';
        return;
      }

      let index = 0;
      let character = 0;
      let deleting = false;
      const tick = () => {
        const current = quotes[index];
        text.textContent = current.text.slice(0, character);
        from.textContent = character === current.text.length && current.from ? `—— ${current.from}` : '';

        if (!deleting) {
          if (character < current.text.length) {
            character += 1;
            window.setTimeout(tick, 48);
          } else {
            deleting = true;
            window.setTimeout(tick, 4200);
          }
          return;
        }

        if (character > 0) {
          character -= 1;
          window.setTimeout(tick, 26);
        } else {
          deleting = false;
          index = (index + 1) % quotes.length;
          window.setTimeout(tick, 550);
        }
      };
      tick();
    };

    const createAiringItem = (item) => {
      const link = document.createElement('a');
      link.className = 'morning-airing-item';
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      if (item.cover) {
        const cover = document.createElement('img');
        cover.src = item.cover;
        cover.alt = '';
        cover.loading = 'lazy';
        cover.width = 56;
        cover.height = 76;
        link.append(cover);
      }

      const details = document.createElement('span');
      details.className = 'morning-airing-details';
      const title = document.createElement('strong');
      title.textContent = item.title;
      details.append(title);
      if (item.subtitle) {
        const subtitle = document.createElement('small');
        subtitle.textContent = item.subtitle;
        details.append(subtitle);
      }
      link.append(details);
      return link;
    };

    const renderMorningReport = (report) => {
      const date = morningReport.querySelector('.morning-report-date');
      const content = document.createElement('div');
      content.className = 'morning-report-content';
      const airing = Array.isArray(report.airing) ? report.airing : [];

      date.dateTime = report.date || '';
      date.textContent = [report.date, report.weekday].filter(Boolean).join(' · ');

      const airingSection = document.createElement('section');
      airingSection.className = 'morning-airing';
      const airingTitle = document.createElement('div');
      airingTitle.className = 'morning-section-label';
      const label = document.createElement('span');
      label.textContent = '今日放送';
      const count = document.createElement('small');
      count.textContent = `共 ${report.total || airing.length} 部更新`;
      airingTitle.append(label, count);
      const airingList = document.createElement('div');
      airingList.className = 'morning-airing-list';
      airing.forEach((item) => airingList.append(createAiringItem(item)));
      airingSection.append(airingTitle, airingList);
      content.append(airingSection);

      const quotes = getAnimeQuotes(report);
      if (quotes.length) {
        const quote = document.createElement('blockquote');
        quote.className = 'morning-quote';
        startAnimeQuoteCycle(quote, quotes);
        content.append(quote);
      }

      const footer = document.createElement('div');
      footer.className = 'morning-report-footer';
      const source = document.createElement('span');
      source.textContent = '数据：Bangumi · Hitokoto';
      const more = document.createElement('a');
      more.href = report.calendarUrl || 'https://bgm.tv/calendar';
      more.target = '_blank';
      more.rel = 'noopener noreferrer';
      more.textContent = '查看全部今日放送';
      footer.append(source, more);
      content.append(footer);

      morningReport.querySelector('.morning-report-loading, .morning-report-error')?.replaceWith(content);
    };

    const showMorningReportError = () => {
      const errorState = document.createElement('div');
      errorState.className = 'morning-report-error';
      errorState.setAttribute('role', 'status');
      const message = document.createElement('span');
      message.textContent = '日报暂时无法加载，请稍后重试。';
      const retry = document.createElement('button');
      retry.className = 'morning-report-retry';
      retry.type = 'button';
      retry.textContent = '重试';
      retry.addEventListener('click', loadMorningReport);
      errorState.append(message, retry);
      morningReport.querySelector('.morning-report-loading, .morning-report-error')?.replaceWith(errorState);
    };

    const loadMorningReport = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);

      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`Morning report request failed: ${response.status}`);
        renderMorningReport(await response.json());
      } catch (error) {
        console.warn('Morning report unavailable', error);
        showMorningReportError();
      } finally {
        window.clearTimeout(timeout);
      }
    };

    loadMorningReport();
  }

  const musicToggle = document.getElementById('music-toggle');
  const musicPanel = document.getElementById('music-panel');
  const musicClose = document.getElementById('music-close');
  const musicStop = document.getElementById('music-stop');
  const musicFrameSlot = document.getElementById('music-frame-slot');

  if (musicToggle && musicPanel && musicClose && musicStop && musicFrameSlot) {
    const collapseMusic = () => {
      musicPanel.hidden = true;
      musicToggle.setAttribute('aria-expanded', 'false');
    };

    const stopMusic = () => {
      collapseMusic();
      musicFrameSlot.replaceChildren();
    };

    const openMusic = () => {
      if (!musicFrameSlot.querySelector('iframe')) {
        const frame = document.createElement('iframe');
        frame.src = musicPanel.dataset.playerUrl;
        frame.title = '网易云音乐歌单播放器';
        frame.allow = 'autoplay';
        frame.loading = 'lazy';
        musicFrameSlot.append(frame);
      }
      musicPanel.hidden = false;
      musicToggle.setAttribute('aria-expanded', 'true');
    };

    musicToggle.addEventListener('click', () => musicPanel.hidden ? openMusic() : collapseMusic());
    musicClose.addEventListener('click', collapseMusic);
    musicStop.addEventListener('click', stopMusic);
  }

  const readingStorageKey = 'blog-reading-list';
  const readingList = document.getElementById('reading-list');
  const saveArticleButton = document.querySelector('[data-reading-save]');

  const getSavedArticles = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(readingStorageKey) || '[]');
      return Array.isArray(saved) ? saved.filter((item) => item && item.url && item.title) : [];
    } catch {
      return [];
    }
  };

  const saveArticles = (articles) => {
    try {
      localStorage.setItem(readingStorageKey, JSON.stringify(articles.slice(0, 30)));
    } catch (error) {
      console.warn('Reading list could not be saved', error);
    }
  };

  const updateSaveButton = (saved) => {
    if (!saveArticleButton) return;
    const label = saveArticleButton.querySelector('[data-reading-save-label]');
    saveArticleButton.classList.toggle('is-saved', saved);
    saveArticleButton.setAttribute('aria-pressed', String(saved));
    if (label) label.textContent = saved ? '已加入稍后读' : '加入稍后读';
  };

  const renderReadingList = () => {
    if (!readingList) return;
    const content = readingList.querySelector('[data-reading-list-content]');
    const count = readingList.querySelector('[data-reading-list-count]');
    const articles = getSavedArticles();
    count.textContent = `${articles.length} 篇`;
    content.replaceChildren();

    if (!articles.length) {
      const empty = document.createElement('p');
      empty.className = 'reading-list-empty';
      empty.textContent = '把想慢慢看的文章存到这里。';
      content.append(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'reading-list-items';
    articles.forEach((article) => {
      const item = document.createElement('article');
      item.className = 'reading-list-item';
      const link = document.createElement('a');
      link.href = article.url;
      const title = document.createElement('strong');
      title.textContent = article.title;
      const meta = document.createElement('span');
      meta.textContent = [article.date, article.minutes ? `${article.minutes} 分钟阅读` : ''].filter(Boolean).join(' · ');
      link.append(title, meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'reading-list-remove';
      remove.dataset.readingRemove = article.url;
      remove.setAttribute('aria-label', `从稍后读移除《${article.title}》`);
      remove.title = '从稍后读移除';
      remove.textContent = '×';
      item.append(link, remove);
      list.append(item);
    });
    content.append(list);
  };

  if (saveArticleButton) {
    const article = {
      url: saveArticleButton.dataset.readingUrl,
      title: saveArticleButton.dataset.readingTitle,
      date: saveArticleButton.dataset.readingDate,
      minutes: saveArticleButton.dataset.readingMinutes,
    };
    updateSaveButton(getSavedArticles().some((item) => item.url === article.url));
    saveArticleButton.addEventListener('click', () => {
      const articles = getSavedArticles();
      const index = articles.findIndex((item) => item.url === article.url);
      if (index === -1) articles.unshift(article);
      else articles.splice(index, 1);
      saveArticles(articles);
      updateSaveButton(index === -1);
      renderReadingList();
    });
  }

  const likeStorageKey = 'blog-liked-articles';
  const likeArticleButton = document.querySelector('[data-article-like]');

  const getLikedArticles = () => {
    try {
      const liked = JSON.parse(localStorage.getItem(likeStorageKey) || '[]');
      return Array.isArray(liked) ? liked : [];
    } catch {
      return [];
    }
  };

  const updateLikeButton = (liked) => {
    if (!likeArticleButton) return;
    const icon = likeArticleButton.querySelector('[data-article-like-icon]');
    const label = likeArticleButton.querySelector('[data-article-like-label]');
    const count = likeArticleButton.querySelector('[data-article-like-count]');
    likeArticleButton.classList.toggle('is-liked', liked);
    likeArticleButton.setAttribute('aria-pressed', String(liked));
    likeArticleButton.title = liked ? '取消喜欢' : '喜欢这篇文章';
    if (icon) icon.textContent = String.fromCodePoint(liked ? 0x2665 : 0x2661);
    if (label) label.textContent = liked ? '已喜欢' : '喜欢';
    if (count) count.textContent = liked ? '1' : '0';
  };

  if (likeArticleButton) {
    const articleUrl = likeArticleButton.dataset.articleUrl;
    updateLikeButton(getLikedArticles().includes(articleUrl));
    likeArticleButton.addEventListener('click', () => {
      const liked = getLikedArticles();
      const index = liked.indexOf(articleUrl);
      if (index === -1) liked.push(articleUrl);
      else liked.splice(index, 1);
      try {
        localStorage.setItem(likeStorageKey, JSON.stringify(liked));
      } catch (error) {
        console.warn('Article like could not be saved', error);
      }
      updateLikeButton(index === -1);
    });
  }

  readingList?.addEventListener('click', (event) => {
    const remove = event.target.closest('[data-reading-remove]');
    if (!remove) return;
    const articles = getSavedArticles().filter((item) => item.url !== remove.dataset.readingRemove);
    saveArticles(articles);
    renderReadingList();
  });
  renderReadingList();

  const siteStatus = document.getElementById('site-status');
  const siteUptime = siteStatus?.querySelector('[data-site-uptime]');
  const siteClock = siteStatus?.querySelector('[data-site-clock]');

  if (siteClock) {
    const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const updateSiteClock = () => { siteClock.textContent = clockFormatter.format(new Date()); };
    updateSiteClock();
    window.setInterval(updateSiteClock, 1000);
  }

  if (siteUptime) {
    const startedAt = new Date(siteStatus.dataset.siteStartedAt);
    const updateSiteUptime = () => {
      const elapsed = Date.now() - startedAt.getTime();
      if (Number.isNaN(elapsed) || elapsed < 0) {
        siteUptime.textContent = '等待启程';
        return;
      }
      const totalMinutes = Math.floor(elapsed / 60000);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      siteUptime.textContent = `${days} 天 ${hours} 小时 ${minutes} 分`;
    };
    updateSiteUptime();
    window.setInterval(updateSiteUptime, 60000);
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
