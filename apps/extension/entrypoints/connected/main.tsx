import { mount } from '../../src/ui/mount.tsx';
import { App } from './App.tsx';

// The OAuth redirect page. It runs only top-level: framed, it does nothing. The code leaves the address bar
// and history before anything renders.
if (window.top === window) {
  const url = location.href;
  history.replaceState(null, '', location.pathname);
  mount(<App url={url} />);
}
