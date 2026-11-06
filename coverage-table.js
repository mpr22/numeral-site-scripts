  document.addEventListener('DOMContentLoaded', () => {
    // Selectors
    const tableRows = document.querySelectorAll('.coverage-table_row');
    const dropdownWrapper = document.querySelector('.coverage-table_dropdown-wrapper');
    const dropdownHeader = document.querySelector('.coverage-table_dropdown-header');
    const selectedTextContainer = document.querySelector('.coverage-table_dropdown-header-selected');
    const selectedTextValue = document.querySelector('.coverage-table_dropdown-header-selected-text');
    const dropdownOptions = document.querySelector('.coverage-table_dropdown-options');
    const optionItems = document.querySelectorAll('.coverage-table_dropdown-option');

    // Standardized normalization: lowercase, trim, and collapse multiple spaces
    const normalize = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ');

    // 1. STATUS ICONS
    const STATUS_ICONS = {
      live: 'https://cdn.prod.website-files.com/6a219d3ca4f9ef92939b285c/6a7015902c071c033556afa8_CircleCheck.svg',
      'coming soon': 'https://cdn.prod.website-files.com/6a219d3ca4f9ef92939b285c/6a7015d62b707ca87b8f7253_Circle.svg',
      waiting: 'https://cdn.prod.website-files.com/6a219d3ca4f9ef92939b285c/6a7015d62b707ca87b8f7253_Circle.svg',
    };

    tableRows.forEach((row) => {
      if (row.classList.contains('table-header')) return;

      const status = normalize(row.getAttribute('data-status'));
      const icon = row.querySelector('.coverage-table_row-status-icon');

      if (!icon) return;

      const src = STATUS_ICONS[status];

      if (src) {
        icon.outerHTML = `
      <img
        class="coverage-table_row-status-icon"
        src="${src}"
        alt=""
        width="24"
        height="24"
      >
    `;
      }
    });

    // 2. TABLE FILTERING
    const filterTable = (filterValue) => {
      const normalizedFilter = normalize(filterValue);
      tableRows.forEach((row) => {
        if (row.classList.contains('table-header')) return;
        const normalizedRowText = normalize(row.textContent);

        const isMatch = normalizedFilter === 'all' || normalizedFilter === 'show all' || normalizedRowText.includes(normalizedFilter);

        row.classList.toggle('hidden', !isMatch);
      });
    };

    // Dropdown Logic
    dropdownHeader?.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownHeader.classList.toggle('open');
      dropdownOptions?.classList.toggle('open');
    });

    optionItems.forEach((option) => {
      option.addEventListener('click', () => {
        const val = option.textContent.trim();
        dropdownHeader.classList.add('has-selection');
        if (selectedTextValue) selectedTextValue.textContent = val;
        if (selectedTextContainer) selectedTextContainer.style.display = 'flex';
        filterTable(val);
        dropdownHeader.classList.remove('open');
        dropdownOptions?.classList.remove('open');
      });
    });

    document.addEventListener('click', (e) => {
      if (dropdownWrapper && !dropdownWrapper.contains(e.target)) {
        dropdownHeader?.classList.remove('open');
        dropdownOptions?.classList.remove('open');
      }
    });

    // The map is the 3D coverage globe (coverage-globe.js in this repo); it reads the same rows.
  });
