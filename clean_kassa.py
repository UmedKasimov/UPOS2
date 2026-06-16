import re

def clean_kassa():
    with open(r"c:\Project\U-POS-FINANCE\pyweb\upos\static\kassa-page.js", "r", encoding="utf-8") as f:
        content = f.read()

    # 1. Remove COLUMN_FILTER_KEY
    content = re.sub(r"const COLUMN_FILTER_KEY = 'upos:kassa:column-filters:v1';\n\s*", "", content)

    # 2. Remove filter: '...' from COLUMN_DEFS
    content = re.sub(r", filter:\s*'[^']+'", "", content)

    # 3. Remove columnFilters let
    content = re.sub(r"let columnFilters = {};\n\s*", "", content)

    # 4. Remove columnFilters from loadColumnPrefs
    content = re.sub(r"try \{\s*const rawFilters = JSON\.parse\(safeStorageGet\(COLUMN_FILTER_KEY\) \|\| '\{\}'\);\s*columnFilters = rawFilters && typeof rawFilters === 'object' \? rawFilters : \{\};\s*\} catch \{\s*columnFilters = \{\};\s*\}\s*", "", content)

    # 5. Remove saveColumnFilters
    content = re.sub(r"function saveColumnFilters\(\) \{\s*safeStorageSet\(COLUMN_FILTER_KEY, JSON\.stringify\(columnFilters\)\);\s*\}\s*", "", content)

    # 6. Clean renderTableHeader (remove filterActive, filterBtn)
    # The current renderTableHeader:
    # const dragAttrs = def.locked ? '' : ' draggable="true"';
    # (Since I already removed filterBtn in the second try, let's just make sure it's clean)
    # Wait, my revert brought it back, then I replaced it.
    # Let's replace the whole renderTableHeader just to be perfectly sure.
    render_header_new = """  function renderTableHeader() {
    const theadRow = els.table?.querySelector('thead tr');
    if (!theadRow) return;
    theadRow.innerHTML = columnOrder.map((key) => {
      const def = columnDef(key);
      if (!def) return '';
      const dragAttrs = def.locked ? '' : ' draggable="true"';
      const sortActive = columnSort.key === key ? ` is-sorted sort-${columnSort.dir}` : '';
      const sortMark = columnSort.key === key ? (columnSort.dir === 'asc' ? '↑' : '↓') : '';
      const label = key === 'checkbox' ? '<input type="checkbox" id="kassa-select-all" />' : escapeHtml(def.label);
      return `<th class="${escapeHtml(def.className)}${sortActive}" data-col="${escapeHtml(key)}"${dragAttrs}>
        <span class="kassa-th-inner">
          <button type="button" class="kassa-th-label" data-col-sort="${escapeHtml(key)}" ${def.locked ? 'tabindex="-1"' : ''}>${label}</button>
          ${sortMark ? `<span class="kassa-sort-mark" aria-hidden="true">${sortMark}</span>` : ''}
        </span>
      </th>`;
    }).join('');
  }"""
    # Find renderTableHeader to applyColumnOrderToDom
    content = re.sub(r"function renderTableHeader\(\) \{.*?\}(?=\s*function applyColumnOrderToDom)", render_header_new, content, flags=re.DOTALL)

    # 7. Remove renderColumnFilterPanel, columnMatches, and uniqueColumnValues
    content = re.sub(r"function uniqueColumnValues\(key\) \{.*?\}(?=\s*function renderTableHeader)", "", content, flags=re.DOTALL)
    content = re.sub(r"function renderColumnFilterPanel\(key, anchor\) \{.*?\}(?=\s*function columnMatches)", "", content, flags=re.DOTALL)
    content = re.sub(r"function columnMatches\(tx, key, raw\) \{.*?\}(?=\s*function sortRows)", "", content, flags=re.DOTALL)

    # 8. Remove column filter logic from applyFilters
    content = re.sub(r"for \(const \[key, val\] of Object\.entries\(columnFilters\)\) \{\s*if \(\!columnMatches\(tx, key, val\)\) return false;\s*\}\s*", "", content)

    # 9. Remove filterBtn listener from bindEvents
    content = re.sub(r"const filterBtn = ev\.target\.closest\('\[data-col-filter\]'\);\s*if \(filterBtn\) \{\s*ev\.preventDefault\(\);\s*ev\.stopPropagation\(\);\s*renderColumnFilterPanel\(filterBtn\.getAttribute\('data-col-filter'\), filterBtn\);\s*return;\s*\}\s*", "", content)

    # 10. Remove panel.hidden from click outside
    content = re.sub(r"const panel = document\.getElementById\('kassa-column-filter-panel'\);\s*if \(panel\) panel\.hidden = true;\s*", "", content)

    with open(r"c:\Project\U-POS-FINANCE\pyweb\upos\static\kassa-page.js", "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    clean_kassa()
