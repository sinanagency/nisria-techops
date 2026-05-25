// Dashboard — auto-refresh source status every 60 seconds
(function () {
    // Could be enhanced with Chart.js for visual stats
    // For now, just periodic status refresh via AJAX
    async function refreshStatus() {
        try {
            const resp = await fetch('/api/v1/sources/status');
            if (!resp.ok) return;
            // Status data available for future dynamic updates
        } catch (e) {
            // Silently fail — page still works from server render
        }
    }

    setInterval(refreshStatus, 60000);
})();
