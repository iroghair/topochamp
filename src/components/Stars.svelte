<script lang="ts">
  let { count, max = 3 }: { count: number; max?: number } = $props();
</script>

<span class="stars" aria-label="{count}/{max}">
  {#each Array(max) as _, i (i)}
    <span class:on={i < count}>★</span>
  {/each}
</span>

<style>
  .stars {
    font-size: 1.4rem;
    letter-spacing: 1px;
    color: #d4dbe3;
  }
  .on {
    color: #ffc21a;
    text-shadow: 0 1px 0 #d89a00;
  }
</style>
