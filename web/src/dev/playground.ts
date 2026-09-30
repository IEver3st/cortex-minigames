import { mount } from 'svelte';
import Playground from './Playground.svelte';

export function mountPlayground(): void {
  const host = document.createElement('div');
  host.id = 'playground';
  document.body.appendChild(host);
  mount(Playground, { target: host });
}
