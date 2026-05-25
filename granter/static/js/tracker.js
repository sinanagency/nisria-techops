// Tracker page — minimal interactivity for pipeline cards
// Full drag-and-drop could be added with SortableJS if needed

(function () {
    // Highlight current stage column
    const cards = document.querySelectorAll('.pipeline-card');
    cards.forEach(function (card) {
        card.addEventListener('mouseenter', function () {
            card.style.transform = 'translateY(-2px)';
        });
        card.addEventListener('mouseleave', function () {
            card.style.transform = '';
        });
    });
})();
