import './style.css';
import { h } from './ui/components';
import { batchesPage } from './ui/batchesPage';
import { candlingPage } from './ui/candlingPage';
import { housesPage } from './ui/housesPage';
import { reviewPage } from './ui/reviewPage';

const NAV = [
  { path: 'batches', label: '入孵批次' },
  { path: 'candling', label: '照蛋结果' },
  { path: 'houses', label: '种鸡舍统计' },
  { path: 'review', label: '人工复核' },
];

function route(): { page: string; param?: string } {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, param] = hash.split('/');
  return { page: page || 'batches', param };
}

function render() {
  const app = document.getElementById('app')!;
  const { page, param } = route();

  const nav = h('nav', {},
    h('span', { className: 'logo' }, '🥚 照蛋分析'),
    ...NAV.map((n) =>
      h('a', { href: `#/${n.path}`, className: page === n.path ? 'active' : '' }, n.label),
    ),
  );

  let content: HTMLElement;
  switch (page) {
    case 'candling':
      content = candlingPage(param);
      break;
    case 'houses':
      content = housesPage();
      break;
    case 'review':
      content = reviewPage();
      break;
    default:
      content = batchesPage();
  }

  app.replaceChildren(nav, h('main', {}, content));
}

window.addEventListener('hashchange', render);
render();
