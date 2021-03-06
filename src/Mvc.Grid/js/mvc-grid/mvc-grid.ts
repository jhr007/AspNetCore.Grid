/*!
 * Mvc.Grid 6.0.0
 * https://github.com/NonFactors/AspNetCore.Grid
 *
 * Copyright © NonFactors
 *
 * Licensed under the terms of the MIT License
 * http://www.opensource.org/licenses/mit-license.php
 */

export interface MvcGridOptions {
    url: URL;
    id: string;
    query: string;
    isAjax: boolean;
    loadingDelay: number;
    filters: {
        [type: string]: typeof MvcGridFilter
    };
}

export interface MvcGridLanguage {
    [type: string]: {
        [method: string]: string
    };
}

export class MvcGrid {
    private static instances: MvcGrid[] = [];
    public static lang: MvcGridLanguage = {
        text: {
            "contains": "Contains",
            "equals": "Equals",
            "not-equals": "Not equals",
            "starts-with": "Starts with",
            "ends-with": "Ends with"
        },
        number: {
            "equals": "Equals",
            "not-equals": "Not equals",
            "less-than": "Less than",
            "greater-than": "Greater than",
            "less-than-or-equal": "Less than or equal",
            "greater-than-or-equal": "Greater than or equal"
        },
        date: {
            "equals": "Equals",
            "not-equals": "Not equals",
            "earlier-than": "Earlier than",
            "later-than": "Later than",
            "earlier-than-or-equal": "Earlier than or equal",
            "later-than-or-equal": "Later than or equal"
        },
        enum: {
            "equals": "Equals",
            "not-equals": "Not equals"
        },
        guid: {
            "equals": "Equals",
            "not-equals": "Not equals"
        },
        boolean: {
            "equals": "Equals",
            "not-equals": "Not equals"
        },
        filter: {
            "apply": "&#10003;",
            "remove": "&#10008;"
        },
        operator: {
            "select": "",
            "and": "and",
            "or": "or"
        }
    };

    element: HTMLElement;
    columns: MvcGridColumn[];

    pager?: MvcGridPager;
    loader?: HTMLDivElement;
    controller: AbortController;

    url: URL;
    name: string;
    prefix: string;
    isAjax: boolean;
    loadingDelay: number;
    loadingTimerId?: number;
    sort: Map<string, "asc" | "desc">;
    filterMode: "row" | "excel" | "header";
    filters: {
        [type: string]: typeof MvcGridFilter
    };

    public constructor(container: HTMLElement, options: Partial<MvcGridOptions> = {}) {
        const grid = this;
        const element = grid.findGrid(container);

        if (element.dataset.id) {
            return MvcGrid.instances[parseInt(element.dataset.id)].set(options);
        }

        grid.columns = [];
        grid.element = element;
        grid.loadingDelay = 300;
        grid.name = element.dataset.name!;
        grid.controller = new AbortController();
        grid.isAjax = Boolean(element.dataset.url);
        grid.prefix = grid.name ? `${grid.name}-` : "";
        grid.filterMode = <any>(element.dataset.filterMode|| "").toLowerCase();
        element.dataset.id = options.id || MvcGrid.instances.length.toString();
        grid.url = element.dataset.url ? new URL(element.dataset.url, location.href) : new URL(location.href);
        grid.url = options.url ? new URL(options.url.toString(), location.href) : grid.url;
        grid.url = options.query ? new URL(`?${options.query}`, grid.url.href) : grid.url;
        grid.sort = grid.buildSort();
        grid.filters = {
            enum: MvcGridEnumFilter,
            date: MvcGridDateFilter,
            guid: MvcGridGuidFilter,
            text: MvcGridTextFilter,
            number: MvcGridNumberFilter,
            boolean: MvcGridBooleanFilter
        };

        const rowFilters = element.querySelectorAll<HTMLTableHeaderCellElement>(".mvc-grid-row-filters th");

        for (const [i, header] of element.querySelectorAll<HTMLTableHeaderCellElement>(".mvc-grid-headers th").entries()) {
            grid.columns.push(new MvcGridColumn(grid, header, rowFilters[i]));
        }

        const pager = element.querySelector<HTMLElement>(".mvc-grid-pager");

        if (pager) {
            grid.pager = new MvcGridPager(grid, pager);
        }

        grid.set(options);
        grid.cleanUp();
        grid.bind();

        if (options.id) {
            MvcGrid.instances[parseInt(options.id)] = grid;
        } else {
            MvcGrid.instances.push(grid);
        }

        if (!element.children.length) {
            grid.reload();
        }
    }

    public set(options: Partial<MvcGridOptions>): MvcGrid {
        const grid = this;

        grid.loadingDelay = typeof options.loadingDelay == "number" ? options.loadingDelay : grid.loadingDelay;
        grid.url = options.url ? new URL(options.url.toString(), location.href) : grid.url;
        grid.url = options.query ? new URL(`?${options.query}`, grid.url.href) : grid.url;
        grid.isAjax = typeof options.isAjax == "boolean" ? options.isAjax : grid.isAjax;
        grid.filters = Object.assign(grid.filters, options.filters);

        for (const column of grid.columns.filter(col => col.filter)) {
            if (grid.filters[column.filter!.name]) {
                column.filter!.instance = new grid.filters[column.filter!.name](column);
                column.filter!.instance.init();
            }
        }

        return grid;
    }

    public reload(): void {
        const grid = this;

        grid.element.dispatchEvent(new CustomEvent("reloadstart", {
            detail: { grid },
            bubbles: true
        }));

        if (grid.isAjax) {
            const url = new URL(grid.url.href);

            grid.controller.abort();
            MvcGridPopup.lastActiveElement = null;
            grid.controller = new AbortController();
            url.searchParams.set("_", String(Date.now()));

            if (grid.loadingDelay != null) {
                if (grid.loader && grid.loader.parentElement) {
                    clearTimeout(grid.loadingTimerId);
                } else {
                    const loader = document.createElement("template");

                    loader.innerHTML = `<div class="mvc-grid-loader"><div><div></div><div></div><div></div></div></div>`;
                    grid.loader = <HTMLDivElement>loader.content.firstElementChild;

                    grid.element.appendChild(grid.loader);
                }

                grid.loadingTimerId = setTimeout(() => {
                    grid.loader!.classList.add("mvc-grid-loading");
                }, grid.loadingDelay);
            }

            MvcGridPopup.hide();

            fetch(url.href, {
                signal: grid.controller.signal,
                headers: { "X-Requested-With": "XMLHttpRequest" }
            }).then(response => {
                if (!response.ok) {
                    throw new Error(`Invalid response status: ${response.status}`)
                }

                return response.text();
            }).then(response => {
                const parent = grid.element.parentElement!;
                const template = document.createElement("template");
                const i = ([] as HTMLElement[]).indexOf.call(parent.children, grid.element);

                template.innerHTML = response.trim();

                if (template.content.firstElementChild!.classList.contains("mvc-grid")) {
                    grid.element.outerHTML = response;
                } else {
                    throw new Error("Grid partial should only include grid declaration.");
                }

                const newGrid = new MvcGrid(<HTMLElement>parent!.children[i], {
                    loadingDelay: grid.loadingDelay,
                    id: grid.element.dataset.id,
                    filters: grid.filters,
                    isAjax: grid.isAjax,
                    url: grid.url
                });

                newGrid.element.dispatchEvent(new CustomEvent("reloadend", {
                    detail: { grid: newGrid },
                    bubbles: true
                }));
            }).catch(reason => {
                if (reason.name == "AbortError") {
                    return Promise.resolve();
                }

                if (grid.loader && grid.loader.parentElement) {
                    grid.loader.parentElement.removeChild(grid.loader);
                }

                grid.element.dispatchEvent(new CustomEvent("reloadfail", {
                    detail: { grid, result: reason },
                    bubbles: true
                }));

                return Promise.reject(reason);
            });
        } else {
            location.href = grid.url.href;
        }
    }

    private buildSort(): Map<string, "asc" | "desc"> {
        const map = new Map();
        const definitions = /(^|,)(.*?) (asc|desc)(?=$|,)/g;
        const sort = this.url.searchParams.get(`${this.prefix}sort`) || "";

        let match = definitions.exec(sort);

        while (match) {
            map.set(match[2], match[3]);

            match = definitions.exec(sort);
        }

        return map;
    }
    private findGrid(element: HTMLElement): HTMLElement {
        const grid = element.closest<HTMLElement>(".mvc-grid");

        if (!grid) {
            throw new Error("Grid can only be created from within mvc-grid structure.");
        }

        return grid;
    }
    private cleanUp(): void {
        delete this.element.dataset.filterMode;
        delete this.element.dataset.url;
    }
    private bind(): void {
        const grid = this;

        for (const row of grid.element.querySelectorAll<HTMLTableRowElement>("tbody tr")) {
            if (!row.classList.contains("mvc-grid-empty-row")) {
                row.addEventListener("click", function (e) {
                    const data: { [type: string]: string } = {};

                    for (const [i, column] of grid.columns.entries()) {
                        data[column.name!] = row.cells[i].innerText;
                    }

                    this.dispatchEvent(new CustomEvent("rowclick", {
                        detail: { grid: grid, data: data, originalEvent: e },
                        bubbles: true
                    }));
                });
            }
        }
    }
}

export class MvcGridColumn {
    name: string;
    grid: MvcGrid;
    isHidden: boolean;
    header: HTMLElement;
    sort: MvcGridColumnSort | null;
    filter: MvcGridColumnFilter | null;

    public constructor(grid: MvcGrid, header: HTMLElement, rowFilter: HTMLElement | null) {
        const column = this;
        const data = header.dataset;

        column.grid = grid;
        column.header = header;
        column.name = data.name!;
        column.isHidden = header.classList.contains("mvc-grid-hidden");
        column.sort = data.sort == "True" ? new MvcGridColumnSort(column) : null;
        column.filter = data.filter == "True" && data.filterName ? new MvcGridColumnFilter(column, rowFilter) : null;

        column.cleanUp();
    }

    private cleanUp(): void {
        const data = this.header.dataset;

        delete data.filterDefaultMethod;
        delete data.filterApplied;
        delete data.filterType;
        delete data.filterName;
        delete data.filter;

        delete data.sortOrder;
        delete data.sortFirst;
        delete data.sort;

        delete data.name;
    }
}

export class MvcGridColumnSort {
    column: MvcGridColumn;
    button: HTMLButtonElement;

    first: "asc" | "desc";
    order: "asc" | "desc" | "";

    constructor(column: MvcGridColumn) {
        const sort = this;

        sort.column = column;
        sort.first = <any>column.header.dataset.sortFirst!.toLowerCase();
        sort.order = <any>column.header.dataset.sortOrder!.toLowerCase();
        sort.button = column.header.querySelector<HTMLButtonElement>(".mvc-grid-sort")!;

        sort.bind();
    }

    public toggle(multi: boolean): void {
        const sort = this;
        const grid = sort.column.grid;
        const map = sort.column.grid.sort;
        const query = grid.url.searchParams;

        if (sort.order == sort.first) {
            sort.order = sort.order == "asc" ? "desc" : "asc";
        } else if (sort.order) {
            sort.order = "";
        } else {
            sort.order = sort.first;
        }

        if (!multi) {
            map.clear();
        }

        if (sort.order) {
            map.set(sort.column.name, sort.order);
        } else {
            map.delete(sort.column.name);
        }

        const order = Array.from(map).map(value => value.join(" ")).join(",");

        query.delete(`${grid.prefix}sort`);

        if (order) {
            query.set(`${grid.prefix}sort`, order);
        }

        grid.reload();
    }

    private bind(): void {
        const sort = this;
        const column = sort.column;

        column.header.addEventListener("click", e => {
            if (!column.filter || column.grid.filterMode != "header") {
                if (!/mvc-grid-(sort|filter)/.test((<HTMLElement>e.target).className)) {
                    sort.toggle(e.ctrlKey || e.shiftKey);
                }
            }
        });

        sort.button.addEventListener("click", e => {
            sort.toggle(e.ctrlKey || e.shiftKey);
        });
    }
}

export class MvcGridColumnFilter {
    name: string;
    isApplied: boolean;
    defaultMethod: string;
    type: "single" | "double" | "multi";
    first: {
        method: string;
        values: string[];
    };
    operator: string;
    second: {
        method: string;
        values: string[];
    };
    column: MvcGridColumn;
    instance: MvcGridFilter;
    button: HTMLButtonElement;
    rowFilter: HTMLElement | null;
    options: HTMLSelectElement | null;
    inlineInput: HTMLInputElement | null;

    constructor(column: MvcGridColumn, rowFilter: HTMLElement | null) {
        const values = [];
        const methods = [];
        const filter = this;
        const data = column.header.dataset;
        const query = column.grid.url.searchParams;
        const name = `${column.grid.prefix + column.name}-`;
        let options = column.header.querySelector<HTMLSelectElement>(".mvc-grid-options");

        if (column.grid.filterMode == "row") {
            options = rowFilter!.querySelector("select");
        }

        if (options && options.classList.contains("mvc-grid-options")) {
            options.parentElement!.removeChild(options);
        }

        for (const parameter of query.entries()) {
            if (parameter[0] != `${name}op` && parameter[0].startsWith(name)) {
                methods.push(parameter[0].substring(name.length));
                values.push(parameter[1]);
            }
        }

        filter.column = column;
        filter.rowFilter = rowFilter;
        filter.name = data.filterName!;
        filter.isApplied = data.filterApplied == "True";
        filter.defaultMethod = data.filterDefaultMethod!;
        filter.type = <any>data.filterType!.toLowerCase() || "single";
        filter.options = options && options.children.length > 0 ? options : null;
        filter.button = (rowFilter || column.header).querySelector<HTMLButtonElement>(".mvc-grid-filter")!;
        filter.inlineInput = rowFilter ? rowFilter.querySelector<HTMLInputElement>(".mvc-grid-value") : null;

        filter.first = {
            method: methods[0] || "",
            values: filter.type == "multi" ? values : values.slice(0, 1)
        };

        filter.operator = filter.type == "double" ? query.get(`${name}op`) || "" : "";

        filter.second = {
            method: filter.type == "double" ? methods[1] || "" : "",
            values: filter.type == "double" ? values.slice(1, 2) : []
        };

        this.bind();
    }

    public apply(): void {
        const grid = this.column.grid;
        const query = grid.url.searchParams;
        const prefix = this.column.grid.prefix;
        const order = query.get(`${prefix}sort`);

        for (const column of grid.columns) {
            for (const key of [...query.keys()]) {
                if (key.startsWith(`${prefix + column.name}-`)) {
                    query.delete(key);
                }
            }
        }

        query.delete(`${prefix}sort`);
        query.delete(`${prefix}page`);
        query.delete(`${prefix}rows`);

        for (const column of grid.columns.filter(col => col.filter && (col == this.column || col.filter.isApplied || col.filter.first.values[0]))) {
            const filter = column.filter!;

            query.set(`${prefix + column.name}-${filter.first.method}`, filter.first.values[0] || "");

            for (let i = 1; filter.type == "multi" && i < filter.first.values.length; i++) {
                query.append(`${prefix + column.name}-${filter.first.method}`, filter.first.values[i] || "");
            }

            if (grid.filterMode == "excel" && filter.type == "double") {
                query.set(`${prefix + column.name}-op`, filter.operator || "");
                query.append(`${prefix + column.name}-${filter.second.method}`, filter.second.values[0] || "");
            }
        }

        if (order) {
            query.set(`${prefix}sort`, order);
        }

        if (grid.pager && grid.pager.showPageSizes) {
            query.set(`${prefix}rows`, grid.pager.rowsPerPage.value);
        }

        grid.reload();
    }
    public cancel(): void {
        const filter = this;
        const column = filter.column;
        const grid = filter.column.grid;
        const query = grid.url.searchParams;

        if (filter.isApplied) {
            query.delete(`${grid.prefix}page`);
            query.delete(`${grid.prefix}rows`);

            for (const key of [...query.keys()]) {
                if (key.startsWith(`${grid.prefix + column.name}-`)) {
                    query.delete(key);
                }
            }

            grid.reload();
        } else {
            filter.first.values = [];
            filter.second.values = [];

            if (column.grid.filterMode != "excel") {
                filter.inlineInput!.value = "";
            }

            MvcGridPopup.hide();
        }
    }

    private bind(): void {
        const filter = this;
        const column = filter.column;
        const mode = column.grid.filterMode;

        filter.button.addEventListener("click", () => {
            MvcGridPopup.show(filter);
        });

        if (filter.options) {
            if (mode == "row" && filter.type != "multi") {
                filter.inlineInput!.addEventListener("change", function () {
                    filter.first.values = [this.value];

                    column.filter!.apply();
                });
            } else if (mode == "header" || mode == "row") {
                filter.inlineInput!.addEventListener("click", function () {
                    if (this.selectionStart == this.selectionEnd) {
                        MvcGridPopup.show(filter);
                    }
                });
            }
        } else if (mode != "excel") {
            filter.inlineInput!.addEventListener("input", function () {
                filter.first.values = [this.value];

                filter.instance.validate(this);
            });

            filter.inlineInput!.addEventListener("keyup", function (e) {
                if (e.which == 13 && filter.instance.isValid(this.value)) {
                    column.filter!.apply();
                }
            });
        }
    }
}

export class MvcGridPager {
    grid: MvcGrid;
    currentPage: string;
    element: HTMLElement;
    showPageSizes: boolean;
    rowsPerPage: HTMLInputElement;
    pages: NodeListOf<HTMLElement>;

    public constructor(grid: MvcGrid, element: HTMLElement) {
        const pager = this;

        pager.grid = grid;
        pager.element = element;
        pager.pages = element.querySelectorAll<HTMLElement>("[data-page]");
        pager.showPageSizes = element.dataset.showPageSizes == "True";
        pager.rowsPerPage = element.querySelector<HTMLInputElement>(".mvc-grid-pager-rows")!;
        pager.currentPage = pager.pages.length ? element.querySelector<HTMLElement>(".active")!.dataset.page! : "1";

        pager.cleanUp();
        pager.bind();
    }

    public apply(page: string): void {
        const grid = this.grid;
        const query = grid.url.searchParams;

        query.delete(`${grid.prefix}page`);
        query.delete(`${grid.prefix}rows`);

        query.set(`${grid.prefix}page`, page);

        if (this.showPageSizes) {
            query.set(`${grid.prefix}rows`, this.rowsPerPage.value);
        }

        grid.reload();
    }

    private cleanUp(): void {
        delete this.element.dataset.showPageSizes;
    }
    private bind(): void {
        const pager = this;

        for (const page of pager.pages) {
            page.addEventListener("click", function () {
                pager.apply(this.dataset.page!);
            });
        }

        pager.rowsPerPage.addEventListener("change", () => {
            pager.apply(pager.currentPage);
        });
    }
}

export class MvcGridPopup {
    static lastActiveElement: HTMLElement | null;
    static element = document.createElement("div");

    public static show(filter: MvcGridColumnFilter): void {
        if (!filter.instance) {
            return;
        }

        const popup = MvcGridPopup;
        const filterer = filter.instance;

        popup.element.className = `mvc-grid-popup ${filterer.cssClasses}`.trim();
        popup.lastActiveElement = <HTMLElement>document.activeElement;
        popup.element.innerHTML = filterer.render();

        document.body.appendChild(popup.element);

        popup.updateValues(filter);
        popup.reposition(filter);
        popup.bind();

        filterer.bindOperator();
        filterer.bindMethods();
        filterer.bindValues();
        filterer.bindActions();

        popup.element.querySelector<HTMLInputElement>(".mvc-grid-value")!.focus();
    }
    public static hide(e?: UIEvent): void {
        const popup = MvcGridPopup;
        const target = e && e.target && (<HTMLElement>e.target).closest && (<HTMLElement>e.target).closest(".mvc-grid-popup,.mvc-grid-filter");

        if ((!target || e!.which == 27) && popup.element.parentNode && (!e || e.target != window)) {
            document.body.removeChild(popup.element);

            if (popup.lastActiveElement) {
                popup.lastActiveElement.focus();
                popup.lastActiveElement = null;
            }
        }
    }

    private static updateValues(filter: MvcGridColumnFilter): void {
        const popup = MvcGridPopup;

        popup.setValues(`.mvc-grid-operator`, [filter.operator]);
        popup.setValues(`.mvc-grid-value[data-filter="first"]`, filter.first.values);
        popup.setValues(`.mvc-grid-value[data-filter="second"]`, filter.second.values);
        popup.setValues(`.mvc-grid-method[data-filter="first"]`, [filter.first.method]);
        popup.setValues(`.mvc-grid-method[data-filter="second"]`, [filter.second.method]);
    }
    private static setValues(selector: string, values: string[]): void {
        const input = MvcGridPopup.element.querySelector<HTMLElement>(selector);

        if (input) {
            if (input.tagName == "SELECT" && (<HTMLSelectElement>input).multiple) {
                ([] as HTMLOptionElement[]).forEach.call((<HTMLSelectElement>input).options, option => {
                    option.selected = values.indexOf(option.value) >= 0;
                });
            } else {
                (<HTMLInputElement>input).value = values[0] || "";
            }
        }
    }

    private static reposition(filter: MvcGridColumnFilter): void {
        const popup = MvcGridPopup;
        const filterButton = filter.button;
        const width = popup.element.clientWidth;
        const filterPos = filterButton.getBoundingClientRect();
        const arrow = popup.element.querySelector<HTMLElement>(".popup-arrow")!;
        const top = window.pageYOffset + filterPos.top + filterButton.offsetHeight * 0.6 + arrow.offsetHeight;

        let left = window.pageXOffset + filterPos.left - 8;
        let arrowLeft = filterButton.offsetWidth / 2;

        if (left + width + 8 > window.pageXOffset + document.documentElement.clientWidth) {
            const offset = width - filterButton.offsetWidth - 16;

            arrowLeft += offset;
            left -= offset;
        }

        popup.element.style.left = `${left}px`;
        popup.element.style.top = `${top}px`;
        arrow.style.left = `${arrowLeft}px`;
    }
    private static bind(): void {
        const popup = MvcGridPopup;

        window.addEventListener("resize", popup.hide);
        window.addEventListener("keydown", popup.hide);
        window.addEventListener("mousedown", popup.hide);
        window.addEventListener("touchstart", popup.hide);
    }
}

export class MvcGridFilter {
    methods: string[];
    cssClasses: string;
    column: MvcGridColumn;
    mode: "row" | "excel" | "header";
    type: "single" | "double" | "multi";

    public constructor(column: MvcGridColumn) {
        const filter = this;

        filter.methods = [];
        filter.column = column;
        filter.cssClasses = "";
        filter.type = column.filter!.type;
        filter.mode = column.grid.filterMode;
    }

    public init(): void {
        const filter = this;
        const column = filter.column;
        const columnFilter = column.filter!;

        if (!columnFilter.options && filter.mode != "excel") {
            filter.validate(columnFilter.inlineInput!);
        }

        if (!columnFilter.first.method) {
            columnFilter.first.method = columnFilter.defaultMethod;
        }

        if (!columnFilter.second.method) {
            columnFilter.second.method = columnFilter.defaultMethod;
        }

        if (filter.methods.indexOf(columnFilter.first.method) < 0) {
            columnFilter.first.method = filter.methods[0];
        }

        if (filter.methods.indexOf(columnFilter.second.method) < 0) {
            columnFilter.second.method = filter.methods[0];
        }
    }
    public isValid(value: string): boolean {
        return !value || true;
    }
    public validate(input: HTMLInputElement): void {
        if (this.isValid(input.value)) {
            input.classList.remove("invalid");
        } else {
            input.classList.add("invalid");
        }
    }

    public render(): string {
        const filter = this;

        return `<div class="popup-arrow"></div>
                <div class="popup-content">
                    <div class="popup-filter">
                       ${filter.renderFilter("first")}
                    </div>
                   ${filter.mode == "excel" && filter.type == "double"
                       ? `${filter.renderOperator()}
                       <div class="popup-filter">
                           ${filter.renderFilter("second")}
                       </div>`
                       : ""}
                   ${filter.renderActions()}
                </div>`;
    }
    public renderFilter(name: "first" | "second"): string {
        const filter = this;
        const options = filter.column.filter!.options;
        const lang = MvcGrid.lang[filter.column.filter!.name] || {};
        const multiple = filter.type == "multi" ? " multiple" : "";
        const methods = filter.methods.map(method => `<option value="${method}">${lang[method] || ""}</option>`).join("");

        return `<div class="popup-group">
                    <select class="mvc-grid-method" data-filter="${name}">
                        ${methods}
                    </select>
                </div>
                <div class="popup-group">${options
                    ? `<select class="mvc-grid-value" data-filter="${name}"${multiple}>
                          ${options.innerHTML}
                       </select>`
                    : `<input class="mvc-grid-value" data-filter="${name}">`}
                </div>`;
    }
    public renderOperator(): string {
        const lang = MvcGrid.lang.operator;

        return `<div class="popup-operator">
                    <div class="popup-group">
                        <select class="mvc-grid-operator">
                            <option value="">${lang.select}</option>
                            <option value="and">${lang.and}</option>
                            <option value="or">${lang.or}</option>
                        </select>
                    </div>
                </div>`;
    }
    public renderActions(): string {
        const lang = MvcGrid.lang.filter;

        return `<div class="popup-actions">
                    <button type="button" class="mvc-grid-apply" type="button">${lang.apply}</button>
                    <button type="button" class="mvc-grid-cancel" type="button">${lang.remove}</button>
                </div>`;
    }

    public bindOperator(): void {
        const filter = this.column.filter!;
        const operator = MvcGridPopup.element.querySelector<HTMLSelectElement>(".mvc-grid-operator");

        if (operator) {
            operator.addEventListener("change", function () {
                filter.operator = this.value;
            });
        }
    }
    public bindMethods(): void {
        const filter = this.column.filter!;

        for (const method of MvcGridPopup.element.querySelectorAll<HTMLInputElement>(".mvc-grid-method")) {
            method.addEventListener("change", function () {
                filter[<"first" | "second">this.dataset.filter].method = this.value;
            });
        }
    }
    public bindValues(): void {
        const filter = this;

        for (const input of MvcGridPopup.element.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".mvc-grid-value")) {
            if (input.tagName == "SELECT") {
                input.addEventListener("change", () => {
                    filter.column.filter![<"first" | "second">input.dataset.filter].values = ([] as HTMLOptionElement[]).filter.call((<HTMLSelectElement>input).options, option => option.selected).map(option => option.value);

                    if (filter.mode != "excel") {
                        const inlineInput = filter.column.filter!.inlineInput!;

                        if (filter.mode == "header" || filter.mode == "row" && filter.type == "multi") {
                            inlineInput.value = ([] as HTMLOptionElement[]).filter
                                .call((<HTMLSelectElement>input).options, option => option.selected)
                                .map(option => option.text)
                                .join(", ");
                        } else {
                            inlineInput.value = input.value;
                        }

                        filter.validate(inlineInput);
                    }
                });
            } else {
                input.addEventListener("input", () => {
                    filter.column.filter![<"first" | "second">input.dataset.filter].values = [input.value];

                    if (filter.mode != "excel") {
                        const inlineInput = filter.column.filter!.inlineInput!;

                        inlineInput.value = filter.column.filter![<"first" | "second">input.dataset.filter].values.join(", ");

                        filter.validate(inlineInput);
                    }

                    filter.validate(<HTMLInputElement>input);
                });

                (<HTMLInputElement>input).addEventListener("keyup", function (e) {
                    if (e.which == 13 && filter.isValid(this.value)) {
                        filter.column.filter!.apply();
                    }
                });

                filter.validate(<HTMLInputElement>input);
            }
        }
    }
    public bindActions(): void {
        const filter = this.column.filter!;
        const popup = MvcGridPopup.element;

        popup.querySelector(".mvc-grid-apply")!.addEventListener("click", filter.apply.bind(filter));
        popup.querySelector(".mvc-grid-cancel")!.addEventListener("click", filter.cancel.bind(filter));
    }
}

export class MvcGridTextFilter extends MvcGridFilter {
    public constructor(column: MvcGridColumn) {
        super(column);

        this.methods = ["contains", "equals", "not-equals", "starts-with", "ends-with"];
    }
}

export class MvcGridNumberFilter extends MvcGridFilter {
    public constructor(column: MvcGridColumn) {
        super(column);

        this.methods = ["equals", "not-equals", "less-than", "greater-than", "less-than-or-equal", "greater-than-or-equal"];
    }

    public isValid(value: string) {
        return !value || /^(?=.*\d+.*)[-+]?\d*[.,]?\d*$/.test(value);
    }
}

export class MvcGridDateFilter extends MvcGridFilter {
    public constructor(column: MvcGridColumn) {
        super(column);

        this.methods = ["equals", "not-equals", "earlier-than", "later-than", "earlier-than-or-equal", "later-than-or-equal"];
    }
}

export class MvcGridEnumFilter extends MvcGridFilter {
    public constructor(column: MvcGridColumn) {
        super(column);

        this.methods = ["equals", "not-equals"];
    }
}

export class MvcGridGuidFilter extends MvcGridFilter {
    public constructor(column: MvcGridColumn) {
        super(column);

        this.methods = ["equals", "not-equals"];
        this.cssClasses = "mvc-grid-guid-filter";
    }

    public isValid(value: string) {
        return !value || /^[0-9A-F]{8}[-]?([0-9A-F]{4}[-]?){3}[0-9A-F]{12}$/i.test(value);
    }
}

export class MvcGridBooleanFilter extends MvcGridFilter {
    public constructor(column: MvcGridColumn) {
        super(column);

        this.methods = ["equals", "not-equals"];
    }
}
