<!-- Record tab: which microphone, what happens while recording and the voice effect of the selected track, and its
     takes. The devices themselves live in their own dialog. -->
<script lang="ts">
  import Icon from '@doblaje/ui/components/Icon.svelte';
  import { t } from '@doblaje/ui/i18n';
  import { mic } from '../../../shell/mic.svelte.ts';
  import { openDevices } from '../../devices/devices.svelte.ts';
  import RecordingSetup from './RecordingSetup.svelte';
  import TakesList from './TakesList.svelte';
  import VoiceEffect from './VoiceEffect.svelte';
</script>

<div class="row" id="record-devices">
  {#if mic.open}<span class="small dim">{t('Microphone')}: {mic.name}</span>{:else}<span class="hint warn">{t('No microphone open yet.')}</span>{/if}
  <div class="spacer"></div>
  <button id="record-devices-btn" onclick={() => openDevices()}><Icon name="mic" />{t('Devices')}</button>
</div>
<RecordingSetup />
<VoiceEffect />
<TakesList />
