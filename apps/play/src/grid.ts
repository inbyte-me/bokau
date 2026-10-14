// Test phones on one computer: N phone frames side by side, each its own player (?seat=n keeps identities apart).
import { mount } from 'svelte';
import Grid from './Grid.svelte';
import './play.css';

mount(Grid, { target: document.getElementById('app') as HTMLElement });
