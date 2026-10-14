<!-- Devices: microphone, listening (headphones or TV), latency and camera — a "green room" before recording,
     reachable from the top bar on every screen. Project settings show only while a project is open. -->
<script lang="ts">
  import Modal from '@doblaje/ui/components/Modal.svelte';
  import { t } from '@doblaje/ui/i18n';
  import CameraBox from './CameraBox.svelte';
  import { closeDevices } from './devices.svelte.ts';
  import LatencySetup from './LatencySetup.svelte';
  import ListenSetup from './ListenSetup.svelte';
  import MicSetup from './MicSetup.svelte';
</script>

<Modal title={t('Devices')} id="devices" onclose={closeDevices}>
  <div class="hint">{t('Pick your microphone, check that the meter moves when you speak, and say whether you wear headphones.')}</div>
  <div class="col">
    <MicSetup autoOpen />
    <ListenSetup />
    <LatencySetup />
    <CameraBox />
  </div>
  {#snippet actions()}
    <button class="primary" id="devices-done" onclick={closeDevices}>{t('Done')}</button>
  {/snippet}
</Modal>
