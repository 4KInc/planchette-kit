// Head pointing and dwell on a plain web page. The page has two buttons, #yes and #no,
// and an element #said. Look at a button and hold still to select it.
import { createPlanchette } from '@planchette/skeleton';

const screen = () => ({ width: window.innerWidth, height: window.innerHeight });
const planchette = createPlanchette({ screen: screen(), profile: { mode: 'head + dwell' } });
for (const id of ['yes', 'no']) {
  const { x, y, width, height } = document.getElementById(id)!.getBoundingClientRect();
  planchette.registerTarget(id, { x, y, width, height });
}
planchette.addEventListener('select', (event) => {
  document.getElementById('said')!.textContent = event.detail.targetId;
});
window.addEventListener('resize', () => planchette.setScreen(screen()));
void planchette.startCamera();
