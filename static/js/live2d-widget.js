(() => {
  if (!window.matchMedia('(min-width: 900px)').matches) return;
  if (document.querySelector('#waifu, script[data-live2d-widget]')) return;

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (connection?.saveData || /(^|-)2g/.test(connection?.effectiveType || '')) return;

  const assetBase = 'https://fastly.jsdelivr.net/npm/live2d-widgets@1.0.0-rc.4/dist/';

  const loadResource = (url, type) => new Promise((resolve, reject) => {
    const element = document.createElement(type === 'css' ? 'link' : 'script');
    if (type === 'css') {
      element.rel = 'stylesheet';
      element.href = url;
    } else {
      // waifu-tips.js is a classic UMD script and exposes initWidget globally.
      // Loading it as a module keeps that symbol scoped and prevents startup.
      element.src = url;
      element.dataset.live2dWidget = 'true';
    }
    element.addEventListener('load', resolve, { once: true });
    element.addEventListener('error', () => reject(new Error(`Unable to load ${url}`)), { once: true });
    document.head.appendChild(element);
  });

  const initialize = () => {
    const OriginalImage = window.Image;
    window.Image = function (...args) {
      const image = new OriginalImage(...args);
      image.crossOrigin = 'anonymous';
      return image;
    };
    window.Image.prototype = OriginalImage.prototype;

    Promise.all([
      loadResource(`${assetBase}waifu.css`, 'css'),
      loadResource(`${assetBase}waifu-tips.js`, 'js'),
    ])
      .then(() => {
        if (typeof window.initWidget !== 'function') {
          throw new Error('Live2D initialization is unavailable.');
        }

        window.initWidget({
          waifuPath: `${assetBase}waifu-tips.json`,
          cdnPath: 'https://fastly.jsdelivr.net/gh/fghrsh/live2d_api/',
          cubism2Path: `${assetBase}live2d.min.js`,
          cubism5Path: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
          tools: ['hitokoto', 'asteroids', 'switch-model', 'switch-texture', 'photo', 'info', 'quit'],
          logLevel: 'warn',
          drag: true,
        });
      })
      .catch((error) => console.error('Unable to load the Live2D widget.', error));
  };

  const startWhenIdle = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(initialize, { timeout: 8000 });
      return;
    }
    window.setTimeout(initialize, 2500);
  };

  if (document.readyState === 'complete') {
    startWhenIdle();
  } else {
    window.addEventListener('load', startWhenIdle, { once: true });
  }
})();
