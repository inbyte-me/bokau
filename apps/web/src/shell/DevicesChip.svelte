<!-- Top bar: is the microphone open and hearing you? Opens the Devices dialog. -->
<script lang="ts">
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { openDevices } from '../features/devices/devices.svelte.ts';
  import { mic } from './mic.svelte.ts';
</script>

<button
  class={['chip', 'devices', mic.open ? 'ok' : 'warn']}
  id="devices-btn"
  title={t('Microphone, headphones, camera and latency')}
  onclick={() => openDevices()}
>
  <Icon name="mic" size={13} />
  <span class="chip-label">{mic.open ? mic.name || t('Mic open') : t('Set up mic')}</span>
  <span class="chip-meter"><i style:width={mic.open ? `${mic.level * 100}%` : '0'}></i></span>
</button>
