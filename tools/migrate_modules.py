import os
import shutil

BASE_DIR = r"d:\全景项目\常州中级人民法院\Netcatty-Cmdb\integrations\netcatty\cmdb"

MIGRATIONS = {
    "core": [
        "api.js",
        "hooks.js",
        "state.js",
        "transport.js"
    ],
    "ui": [
        "ui.jsx",
        "Fields.jsx",
        "Labels.jsx",
        "AssetFilterPicker.jsx"
    ],
    "adapter": [
        "NetcattyConnection.js",
        "NetcattyConnectionFields.jsx",
        "NetcattyDirectory.jsx",
        "NetcattyLinks.jsx",
        "netcattyVaultActions.js",
        "readTelnetConfiguration.js"
    ],
    "modules/assets": [
        "DeviceAssets.jsx",
        "TerminalAssets.jsx",
        "Infrastructure.jsx",
        "InfrastructureEditor.jsx",
        "InfrastructureQuickConnect.jsx",
        "Systems.jsx",
        "AssetPanel.jsx",
        "AssetTransferMenu.jsx",
        "DeviceImages.jsx",
        "DeviceRelations.jsx",
        "DeviceOwnershipBar.jsx",
        "OperatingSystemCell.jsx"
    ],
    "modules/assets/models": [
        "assetFilterModel.js",
        "deviceWorkspaceModel.js",
        "infrastructureEditorModel.js"
    ],
    "modules/assets/taxonomy": [
        "Catalog.jsx",
        "Taxonomy.jsx",
        "VendorBrandIcon.jsx",
        "VendorBrandInput.jsx",
        "vendorBrandModel.js",
        "taxonomyModel.js"
    ],
    "modules/assets/workspace": [
        "DeviceWorkspace.jsx",
        "DeviceWorkspaceErrorBoundary.jsx",
        "SwitchWorkspace.jsx",
        "switchConfig.js",
        "switchPortPanel.js"
    ],
    "modules/org": [
        "Organizations.jsx",
        "People.jsx"
    ],
    "modules/ipam": [
        "IPAM.jsx"
    ],
    "modules/workorders": [
        "WorkOrders.jsx",
        "WorkOrderList.jsx",
        "Operations.jsx",
        "RouterOperations.jsx",
        "ServerOperations.jsx"
    ],
    "modules/settings": [
        "ConfigCenter.jsx",
        "Credentials.jsx",
        "ImportDialog.jsx"
    ]
}

def migrate():
    vendor_src = os.path.join(BASE_DIR, "vendor-icons")
    vendor_dst = os.path.join(BASE_DIR, "modules", "assets", "taxonomy", "vendor-icons")
    if os.path.exists(vendor_src) and not os.path.exists(vendor_dst):
        shutil.copytree(vendor_src, vendor_dst)
        print("Copied vendor-icons to taxonomy/vendor-icons")

    for rel_dir, files in MIGRATIONS.items():
        target_dir = os.path.join(BASE_DIR, rel_dir)
        os.makedirs(target_dir, exist_ok=True)
        for f in files:
            src_file = os.path.join(BASE_DIR, f)
            dst_file = os.path.join(target_dir, f)
            if os.path.exists(src_file):
                with open(src_file, "r", encoding="utf-8") as rf:
                    content = rf.read()
                with open(dst_file, "w", encoding="utf-8") as wf:
                    wf.write(content)
                print(f"Copied {f} -> {rel_dir}/{f}")

    print("All files mirrored to organized modular locations.")

if __name__ == "__main__":
    migrate()
