(() => {
  'use strict';
  const summary = document.getElementById('work-summary');
  if (!summary) return;

  // 必须先于工单控制器建立阶段按钮；数量、筛选与选中态仍由原控制器统一维护。
  const stages = [
    { key: 'new', status: '新建' },
    { key: 'processing', status: '处理中' },
    { key: 'resolved', status: '已解决' },
    { key: 'closed', status: '已关闭' },
    { key: 'cancelled', status: '已取消' },
  ];
  const routes = ['accept', 'resolve', 'confirm'];
  const stageButton = (stage) => `<button type="button" class="work-stage-button work-stage-button--${stage.key}" data-status="${stage.status}" aria-pressed="false" title="点击筛选${stage.status}工单，再次点击取消筛选${stage.key === 'cancelled' ? '；取消为关闭前的可选终止状态，不属于正常成功路线' : ''}"><span class="work-stage-name">${stage.status}</span><span class="work-stage-count" data-count>0</span></button>`;
  const connector = (key) => `<span class="work-stage-connector" aria-hidden="true"><svg viewBox="0 0 32 16" width="32" height="16"><path class="work-stage-line" d="M1 8 H27" data-motion-path="${key}"/><path class="work-stage-arrow" d="m23 4 4 4-4 4"/></svg><span class="work-stage-glint" data-motion-target="${key}"></span></span>`;

  summary.classList.add('work-stage-summary');
  summary.setAttribute('aria-label', '工单阶段概览');
  summary.innerHTML = `
    <div class="work-stage-scroll" tabindex="0" role="region" aria-label="工单阶段，小屏可在此横向滚动">
      <div class="work-stage-row">
        <div class="work-stage-main" role="group" aria-label="正常流转：新建、处理中、已解决、已关闭">
          ${stages.slice(0, 4).map((stage, index) => `${index ? connector(routes[index - 1]) : ''}${stageButton(stage)}`).join('')}
        </div>
        <div class="work-stage-optional" role="group" aria-label="可选终止状态，非正常成功路线">
          ${stageButton(stages[4])}
        </div>
      </div>
    </div>
    <span class="work-stage-motion-note" hidden></span>`;

  const anime = window.anime;
  const motionNote = summary.querySelector('.work-stage-motion-note');
  if (typeof anime?.animate !== 'function' || typeof anime?.svg?.createMotionPath !== 'function') {
    summary.dataset.motion = 'error';
    motionNote.hidden = false;
    motionNote.setAttribute('role', 'status');
    motionNote.textContent = '动画不可用：请检查本地 Anime.js 4.5.0；阶段筛选仍可使用。';
    return;
  }

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const paths = [...summary.querySelectorAll('[data-motion-path]')];
  const glints = [...summary.querySelectorAll('[data-motion-target]')];
  let animations = [], inViewport = false, pageActive = true;

  function cancelAnimations() {
    animations.forEach((animation) => animation.cancel());
    animations = [];
    glints.forEach((glint) => { glint.style.removeProperty('transform'); glint.style.removeProperty('opacity'); });
  }

  function synchronize() {
    if (motionPreference.matches) {
      cancelAnimations();
      summary.dataset.motion = 'reduced';
      return;
    }
    if (!pageActive || document.hidden || !inViewport || document.querySelector('dialog[open]')) {
      animations.forEach((animation) => animation.pause());
      summary.dataset.motion = 'paused';
      return;
    }
    if (!animations.length) {
      // 每条相邻阶段连接线使用独立的局部 SVG 路径，不依赖页面或大画布坐标。
      animations = paths.map((path, index) => {
        const duration = Math.max(1600, path.getTotalLength() * 13);
        return anime.animate(glints[index], {
          ...anime.svg.createMotionPath(path),
          opacity: [{ from: 0, to: 1, duration: 180 }, { to: 1, duration: duration - 360 }, { to: 0, duration: 180 }],
          duration,
          delay: index * 240,
          ease: 'linear',
          loop: true,
          autoplay: false,
        });
      });
    }
    summary.dataset.motion = 'running';
    animations.forEach((animation) => animation.play());
  }

  // 仅维护连接线装饰动画，不监听或改写工单模型；弹窗与页面可见性变化均暂停。
  const visibilityObserver = new IntersectionObserver(([entry]) => { inViewport = entry.isIntersecting; synchronize(); });
  const modalObserver = new MutationObserver(synchronize);
  function connectObservers() {
    visibilityObserver.observe(summary);
    modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  }
  function onPageShow() {
    pageActive = true;
    connectObservers();
    synchronize();
  }
  function onPageHide(event) {
    pageActive = false;
    inViewport = false;
    cancelAnimations();
    summary.dataset.motion = 'paused';
    visibilityObserver.disconnect();
    modalObserver.disconnect();
    if (!event.persisted) {
      document.removeEventListener('visibilitychange', synchronize);
      motionPreference.removeEventListener('change', synchronize);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
    }
  }
  connectObservers();
  document.addEventListener('visibilitychange', synchronize);
  motionPreference.addEventListener('change', synchronize);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  synchronize();
})();