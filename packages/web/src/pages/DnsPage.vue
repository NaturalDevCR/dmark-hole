<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold tracking-tight">DNS Health</h1>
      <p class="text-sm text-muted-foreground">Real-time DNS configuration analysis</p>
    </div>

    <div class="grid gap-4 md:grid-cols-2">
      <div class="rounded-lg border bg-card p-4">
        <h3 class="text-sm font-semibold mb-3">SPF Records</h3>
        <p class="text-xs text-muted-foreground">Select a domain to analyze SPF configuration</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <h3 class="text-sm font-semibold mb-3">DKIM Selectors</h3>
        <p class="text-xs text-muted-foreground">Select a domain to discover DKIM keys</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <h3 class="text-sm font-semibold mb-3">DMARC Policy</h3>
        <p class="text-xs text-muted-foreground">Select a domain to validate DMARC setup</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <h3 class="text-sm font-semibold mb-3">BIMI & MTA-STS</h3>
        <p class="text-xs text-muted-foreground">Select a domain to check advanced protocols</p>
      </div>
    </div>

    <div class="rounded-lg border bg-card p-6">
      <h3 class="text-sm font-semibold mb-3">DNS Snapshots</h3>
      <p class="text-xs text-muted-foreground">Historical DNS configurations with change detection. Visit a domain detail page for full analysis.</p>
    </div>
  </div>
</template>
