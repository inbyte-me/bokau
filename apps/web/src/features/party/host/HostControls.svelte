<!-- The host's hands during a round (the buttons are shared with the phone host: @doblaje/party-ui). -->
<script lang="ts">
  import RoundControls from '@doblaje/party-ui/components/RoundControls.svelte';
  import { getHost } from './host.svelte.ts';

  const host = getHost();
</script>

<RoundControls send={(c) => host.send(c)} />
