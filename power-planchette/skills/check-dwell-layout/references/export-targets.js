// Export the target rectangles of the page that is open right now, in the shape the dwell
// simulator's `simulate` tool takes as `layout`: { screen: { width, height }, targets: [...] }.
//
// How to run it: set the browser window to 1366x768 (then again to 1920x1080), open the view you
// want to test, and run this file's code as one expression in the page (a browser tool's
// "evaluate" or the devtools console). It returns { layout, problems }. Save `layout` as JSON.
// Never start the camera for this: nothing here needs it.
//
// It reads every element with data-planchette-target="<id>" (and data-role="cancel" | "undo" |
// "rest-area", default "default"), exactly as the skeleton's createTargetRegistry does. If the
// page exposes a Planchette instance on a known global, its own getTargets() wins, because that
// is what the engine really uses (it knows auto-repeat targets; the DOM attribute does not).
(() => {
  const ROLES = ['default', 'cancel', 'undo', 'rest-area'];
  const screen = { width: window.innerWidth, height: window.innerHeight };
  const problems = [];
  const instance =
    (window.planchette && window.planchette.getTargets && window.planchette) ||
    (window.planchetteDemo && window.planchetteDemo.planchette) ||
    (window.planchetteSeance && window.planchetteSeance.planchette) ||
    null;
  let targets;
  if (instance) {
    targets = instance.getTargets().map((t) => ({
      id: t.id,
      rect: { x: t.rect.x, y: t.rect.y, width: t.rect.width, height: t.rect.height },
      autoRepeat: t.autoRepeat,
      role: t.role,
    }));
  } else {
    targets = [];
    for (const el of document.querySelectorAll('[data-planchette-target]')) {
      const id = el.dataset.planchetteTarget;
      const r = el.getBoundingClientRect();
      if (!id) {
        problems.push('An element has an empty data-planchette-target.');
        continue;
      }
      if (!(r.width > 0 && r.height > 0)) {
        problems.push('Skipped "' + id + '": it has no size (hidden or collapsed).');
        continue;
      }
      targets.push({
        id,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        autoRepeat: el.dataset.autoRepeat === 'true',
        role: ROLES.includes(el.dataset.role) ? el.dataset.role : 'default',
      });
    }
  }
  const ids = new Set();
  for (const t of targets) {
    if (ids.has(t.id)) problems.push('Duplicate target id "' + t.id + '".');
    ids.add(t.id);
    const { x, y, width, height } = t.rect;
    if (x < 0 || y < 0 || x + width > screen.width || y + height > screen.height) {
      problems.push('"' + t.id + '" is not fully inside the ' + screen.width + 'x' + screen.height + ' viewport.');
    }
  }
  if (!targets.some((t) => t.role === 'rest-area')) problems.push('No rest-area target: add one (data-role="rest-area").');
  if (!targets.some((t) => t.role === 'cancel')) problems.push('No cancel target.');
  const root = document.documentElement;
  if (root.scrollHeight > screen.height || root.scrollWidth > screen.width) {
    problems.push('The page scrolls at ' + screen.width + 'x' + screen.height + '. People who point with their head cannot scroll.');
  }
  return { layout: { screen, targets }, problems };
})();
