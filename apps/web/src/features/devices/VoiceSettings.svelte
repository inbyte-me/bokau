<!-- All the audio settings on one page (the podcast recorder shows them beside the camera). -->
<script lang="ts">
  import RecordingSetup from '../studio/panels/RecordingSetup.svelte';
  import LatencySetup from './LatencySetup.svelte';
  import ListenSetup from './ListenSetup.svelte';
  import MicSetup from './MicSetup.svelte';
</script>

<MicSetup />
<ListenSetup />
<LatencySetup />
<RecordingSetup />
