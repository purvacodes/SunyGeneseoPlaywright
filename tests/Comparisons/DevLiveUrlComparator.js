import XLSX from "xlsx";
import { createObjects } from "../../pages/ObjectFactory.js";

export class DevLiveUrlComparator {
  constructor() {
    this.finalFactory = createObjects();

    this.LIVE_BASE = "https://www.geneseo.edu";
    this.DEV_BASE = "https://dev-suny-geneseo.pantheonsite.io";

    this.fileName = "DevandLiveUrlsComparison.xlsx";
    this.subfolder = "comparison";
  }

  normalize(url = "") {
    return url
      .replace(this.LIVE_BASE, "")
      .replace(this.DEV_BASE, "")
      .trim()
      .replace(/\/$/, ""); // remove trailing slash for comparison
  }

  groupRows(data) {
    const map = {};
    data.forEach(row => {
      const origKey = this.normalize(row.originalUrl);
      const isParent = row.isParent === true || row.isParent === "TRUE";

      if (!map[origKey]) map[origKey] = { parent: null, children: [] };

      if (isParent) map[origKey].parent = row;
      else map[origKey].children.push(row);
    });
    return map;
  }

  async compare() {
    const workbook = XLSX.readFile("Inventory.xlsx");
    const liveSheet = XLSX.utils.sheet_to_json(workbook.Sheets["ParentChild-Live"]);
    const devSheet = XLSX.utils.sheet_to_json(workbook.Sheets["ParentChild-Dev"]);

    const liveGrouped = this.groupRows(liveSheet);
    const devGrouped = this.groupRows(devSheet);

    const outputMain = [];
    const redirectStatusMismatch = [];
    const statusOnlyMismatch = [];

    for (const origKey of Object.keys(liveGrouped)) {
      const live = liveGrouped[origKey];
      const dev = devGrouped[origKey];

      if (!dev) {
        outputMain.push({
          originalUrl: origKey,
          field: "",
          live: "",
          dev: "",
          issue: "Missing in DEV"
        });
        continue;
      }

      const pLive = live.parent;
      const pDev = dev.parent;

      if (!pDev) {
        outputMain.push({
          originalUrl: origKey,
          field: "parent",
          live: "exists",
          dev: "missing",
          issue: "Parent Row Missing in DEV"
        });
      } else {
        const liveRedirect = String(pLive?.isRedirected);
        const devRedirect = String(pDev?.isRedirected);
        const liveFinal = this.normalize(pLive?.finalUrl);
        const devFinal = this.normalize(pDev?.finalUrl);

        const redirectMismatch = liveRedirect !== devRedirect || liveFinal !== devFinal;
        const statusMismatch = String(pLive?.httpStatus) !== String(pDev?.httpStatus);

        // Combined logic for new sheets
        if (redirectMismatch && statusMismatch) {
          redirectStatusMismatch.push({
            originalUrl: origKey,
            live: `isRedirected=${liveRedirect}, finalUrl=${pLive?.finalUrl}, httpStatus=${pLive?.httpStatus}`,
            dev: `isRedirected=${devRedirect}, finalUrl=${pDev?.finalUrl}, httpStatus=${pDev?.httpStatus}`,
            issue: "Redirect AND HTTP Status Mismatch"
          });
        } else if (!redirectMismatch && statusMismatch) {
          statusOnlyMismatch.push({
            originalUrl: origKey,
            live: `httpStatus=${pLive?.httpStatus}`,
            dev: `httpStatus=${pDev?.httpStatus}`,
            issue: "HTTP Status Mismatch"
          });
        }

        if (redirectMismatch) {
          outputMain.push({
            originalUrl: origKey,
            field: "redirect",
            live: `isRedirected=${liveRedirect}, finalUrl=${pLive?.finalUrl}`,
            dev: `isRedirected=${devRedirect}, finalUrl=${pDev?.finalUrl}`,
            issue: "Redirect Mismatch"
          });
        }

        if (String(pLive?.isParent) !== String(pDev?.isParent)) {
          outputMain.push({
            originalUrl: origKey,
            field: "isParent",
            live: pLive.isParent,
            dev: pDev.isParent,
            issue: "Parent Flag Mismatch"
          });
        }

        if (!redirectMismatch && statusMismatch) {
          outputMain.push({
            originalUrl: origKey,
            field: "httpStatus",
            live: pLive.httpStatus,
            dev: pDev.httpStatus,
            issue: "HTTP Status Mismatch"
          });
        }
      }

      // Child URLs
      const liveChildren = live.children.map(c => this.normalize(c.childUrl));
      const devChildren = dev.children.map(c => this.normalize(c.childUrl));

      for (const child of liveChildren) {
        if (!devChildren.includes(child)) {
          outputMain.push({
            originalUrl: origKey,
            field: "childUrl",
            live: child,
            dev: "",
            issue: "Child URL Missing in DEV"
          });
        }
      }
      for (const child of devChildren) {
        if (!liveChildren.includes(child)) {
          outputMain.push({
            originalUrl: origKey,
            field: "childUrl",
            live: "",
            dev: child,
            issue: "Extra Child URL in DEV"
          });
        }
      }
    }

    // Prepare workbook with 3 sheets
    const newWorkbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(newWorkbook, XLSX.utils.json_to_sheet(outputMain), "MainComparison");
    XLSX.utils.book_append_sheet(newWorkbook, XLSX.utils.json_to_sheet(redirectStatusMismatch), "RedirectAndStatusMismatch");
    XLSX.utils.book_append_sheet(newWorkbook, XLSX.utils.json_to_sheet(statusOnlyMismatch), "StatusOnlyMismatch");

    XLSX.writeFile(newWorkbook, `test-artifacts/${this.subfolder}/${this.fileName}`);

    console.log("All comparison sheets successfully generated in one Excel file.");
  }
}
