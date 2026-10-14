import { mount } from 'svelte';
import App from './App.svelte';
import './play.css';

mount(App, { target: document.getElementById('app') as HTMLElement });
