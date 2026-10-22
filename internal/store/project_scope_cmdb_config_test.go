package store

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestProjectScopeCmdbModulesTaxonomyAndConfigIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)

	assetA, err := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "关联资产 A", AssetCode: "REL-A"})
	if err != nil {
		t.Fatalf("创建项目 A 资产: %v", err)
	}
	assetB, err := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{Name: "关联资产 B", AssetCode: "REL-B"})
	if err != nil {
		t.Fatalf("创建项目 B 资产: %v", err)
	}

	catA, err := s.CreateCmdbTaxonomyForProject(scopeA, "categories", "同名设备类型", 0, 1)
	if err != nil {
		t.Fatalf("创建项目 A 分类: %v", err)
	}
	catB, err := s.CreateCmdbTaxonomyForProject(scopeB, "categories", "同名设备类型", 0, 1)
	if err != nil {
		t.Fatalf("创建项目 B 同名分类: %v", err)
	}
	if list, err := s.ListCmdbTaxonomyForProject(scopeA, "categories"); err != nil || !taxonomyContainsID(list, catA) || taxonomyContainsID(list, catB) {
		t.Fatalf("项目 A 分类隔离失败: list=%+v err=%v", list, err)
	}
	if list, err := s.ListCmdbTaxonomyForProject(scopeB, "categories"); err != nil || !taxonomyContainsID(list, catB) || taxonomyContainsID(list, catA) {
		t.Fatalf("项目 B 分类隔离失败: list=%+v err=%v", list, err)
	}

	modelA, err := s.CreateCmdbModelForProject(scopeA, &CmdbDeviceModel{Vendor: "同名厂商", Model: "同名型号"})
	if err != nil {
		t.Fatalf("创建项目 A 型号: %v", err)
	}
	modelB, err := s.CreateCmdbModelForProject(scopeB, &CmdbDeviceModel{Vendor: "同名厂商", Model: "同名型号"})
	if err != nil {
		t.Fatalf("创建项目 B 同名型号: %v", err)
	}
	if models, total, err := s.QueryCmdbModelsForProject(scopeA, "同名", 1, 20); err != nil || total != 1 || models[0].ID != modelA {
		t.Fatalf("项目 A 型号隔离失败: total=%d models=%+v err=%v", total, models, err)
	}
	if models, total, err := s.QueryCmdbModelsForProject(scopeB, "同名", 1, 20); err != nil || total != 1 || models[0].ID != modelB {
		t.Fatalf("项目 B 型号隔离失败: total=%d models=%+v err=%v", total, models, err)
	}

	if _, err := s.CreateCmdbWorkOrderForProject(scopeA, &CmdbWorkOrder{Subject: "同名工单", AssetID: assetA}); err != nil {
		t.Fatalf("创建项目 A 工单: %v", err)
	}
	if _, err := s.CreateCmdbWorkOrderForProject(scopeB, &CmdbWorkOrder{Subject: "同名工单", AssetID: assetB}); err != nil {
		t.Fatalf("创建项目 B 工单: %v", err)
	}
	if _, err := s.CreateCmdbWorkOrderForProject(scopeA, &CmdbWorkOrder{Subject: "跨项目工单", AssetID: assetB}); err == nil {
		t.Fatal("工单不得关联其他项目资产")
	}
	if orders, total, err := s.QueryCmdbWorkOrdersForProject(scopeA, CmdbWorkOrderQuery{Keyword: "同名工单", Page: 1, PageSize: 20}); err != nil || total != 1 || orders[0].AssetID != assetA {
		t.Fatalf("项目 A 工单隔离失败: total=%d orders=%+v err=%v", total, orders, err)
	}

	if _, err := s.CreateCmdbInventoryTaskForProject(scopeA, &CmdbInventoryTask{Name: "同名盘点"}); err != nil {
		t.Fatalf("创建项目 A 盘点: %v", err)
	}
	if _, err := s.CreateCmdbInventoryTaskForProject(scopeB, &CmdbInventoryTask{Name: "同名盘点"}); err != nil {
		t.Fatalf("创建项目 B 盘点: %v", err)
	}
	if tasks, total, err := s.QueryCmdbInventoryTasksForProject(scopeA, "", "同名盘点", 1, 20); err != nil || total != 1 || tasks[0].Name != "同名盘点" {
		t.Fatalf("项目 A 盘点隔离失败: total=%d tasks=%+v err=%v", total, tasks, err)
	}

	if _, err := s.CreateCmdbCredentialForProject(scopeA, &CmdbCredential{Name: "同名凭据", CredType: "SSH", AssetID: assetA}); err != nil {
		t.Fatalf("创建项目 A 凭据: %v", err)
	}
	if _, err := s.CreateCmdbCredentialForProject(scopeB, &CmdbCredential{Name: "同名凭据", CredType: "SSH", AssetID: assetB}); err != nil {
		t.Fatalf("创建项目 B 凭据: %v", err)
	}
	if _, err := s.CreateCmdbCredentialForProject(scopeA, &CmdbCredential{Name: "跨项目凭据", CredType: "SSH", AssetID: assetB}); err == nil {
		t.Fatal("凭据不得关联其他项目资产")
	}
	if creds, total, err := s.QueryCmdbCredentialsForProject(scopeA, "SSH", "同名凭据", 1, 20); err != nil || total != 1 || creds[0].AssetID != assetA {
		t.Fatalf("项目 A 凭据隔离失败: total=%d creds=%+v err=%v", total, creds, err)
	}

	fieldA := &CustomField{FieldKey: "same_field", FieldName: "同名字段", FieldType: "text", AssetClass: "all"}
	fieldB := &CustomField{FieldKey: "same_field", FieldName: "同名字段", FieldType: "text", AssetClass: "all"}
	if _, err := s.SaveCustomFieldForProject(scopeA, fieldA); err != nil {
		t.Fatalf("保存项目 A 自定义字段: %v", err)
	}
	if _, err := s.SaveCustomFieldForProject(scopeB, fieldB); err != nil {
		t.Fatalf("保存项目 B 同名自定义字段: %v", err)
	}
	if fields, err := s.ListCustomFieldsForProject(scopeA, "all"); err != nil || len(fields) != 1 || fields[0].ID != fieldA.ID {
		t.Fatalf("项目 A 自定义字段隔离失败: fields=%+v err=%v", fields, err)
	}

	if _, err := s.CreateIPSubnetForProject(scopeA, &IPSubnet{Name: "同名网段", Category: "专网"}); err != nil {
		t.Fatalf("创建项目 A 网段: %v", err)
	}
	if _, err := s.CreateIPSubnetForProject(scopeB, &IPSubnet{Name: "同名网段", Category: "专网"}); err != nil {
		t.Fatalf("创建项目 B 同名网段: %v", err)
	}
	if subnets, err := s.ListIPSubnetsForProject(scopeA); err != nil || len(subnets) != 1 || subnets[0].Name != "同名网段" {
		t.Fatalf("项目 A 网段隔离失败: subnets=%+v err=%v", subnets, err)
	}
}

func TestProjectScopeModelMetadataListsBeyondManagementPage(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	if _, err := s.db.Exec(`WITH RECURSIVE seq(n) AS
		(SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<501)
		INSERT INTO cmdb_device_models(project_id,vendor,model)
		SELECT ?, '真实厂商', printf('型号-%04d',n) FROM seq`, scopeA.ProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbModelForProject(scopeB, &CmdbDeviceModel{Vendor: "其他项目", Model: "隔离型号"}); err != nil {
		t.Fatal(err)
	}
	models, err := s.ListCmdbModelsForProject(scopeA)
	if err != nil || len(models) != 501 || models[500].Model != "型号-0501" {
		t.Fatalf("元数据列表不得截断型号: count=%d err=%v", len(models), err)
	}
	if _, total, err := s.QueryCmdbModelsForProject(scopeA, "", 1, 500); err != nil || total != 501 {
		t.Fatalf("管理列表分页语义不可变化: total=%d err=%v", total, err)
	}
}

func TestWorkOrderNumberUsesProjectRuleAndIgnoresClientNumber(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatalf("读取默认项目: %v", err)
	}
	if _, err := s.CreateConfigItem(scope, ConfigKindWorkOrderRule, &ConfigItem{
		Name: "GD", Vendor: "-", Version: "YYYYMMDD", Remark: "每日", SortOrder: 4,
	}); err != nil {
		t.Fatalf("保存工单编号规则: %v", err)
	}
	first := &CmdbWorkOrder{OrderNo: "MANUAL", Subject: "第一张工单"}
	second := &CmdbWorkOrder{Subject: "第二张工单"}
	if _, err := s.CreateCmdbWorkOrderForProject(scope, first); err != nil {
		t.Fatalf("创建第一张工单: %v", err)
	}
	if _, err := s.CreateCmdbWorkOrderForProject(scope, second); err != nil {
		t.Fatalf("创建第二张工单: %v", err)
	}
	today := time.Now().Format("20060102")
	if first.OrderNo != "GD-"+today+"-0001" || second.OrderNo != "GD-"+today+"-0002" {
		t.Fatalf("工单编号未按项目规则连续生成: first=%q second=%q", first.OrderNo, second.OrderNo)
	}
}

func TestProjectScopeCmdbModulesCRUDIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	assetA, _ := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "模块资产 A"})
	assetB, _ := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{Name: "模块资产 B"})

	orderA := &CmdbWorkOrder{Subject: "项目 A 工单", AssetID: assetA}
	orderAID, err := s.CreateCmdbWorkOrderForProject(scopeA, orderA)
	if err != nil || orderA.ProjectID != scopeA.ProjectID || orderA.SyncID == "" {
		t.Fatalf("创建工单元数据错误: %+v err=%v", orderA, err)
	}
	orderBID, _ := s.CreateCmdbWorkOrderForProject(scopeB, &CmdbWorkOrder{Subject: "项目 B 工单", AssetID: assetB})
	if _, err := s.GetCmdbWorkOrderForProject(scopeA, orderBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("工单详情越界: %v", err)
	}
	orderA.Subject = "项目 A 已更新"
	if err := s.UpdateCmdbWorkOrderForProject(scopeA, orderA); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateCmdbWorkOrderForProject(scopeA, &CmdbWorkOrder{ID: orderBID, Subject: "越界", AssetID: assetA}); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("工单更新越界: %v", err)
	}
	if err := s.DeleteCmdbWorkOrderForProject(scopeA, orderBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("工单删除越界: %v", err)
	}
	if count, err := s.CountCmdbWorkOrdersForProject(scopeA); err != nil || count != 1 {
		t.Fatalf("工单计数错误: %d %v", count, err)
	}
	if got, err := s.GetCmdbWorkOrderForProject(scopeA, orderAID); err != nil || got.Subject != "项目 A 已更新" {
		t.Fatalf("工单更新未保存: %+v %v", got, err)
	}

	taskA := &CmdbInventoryTask{Name: "项目 A 盘点"}
	if _, err := s.CreateCmdbInventoryTaskForProject(scopeA, taskA); err != nil || taskA.SyncID == "" {
		t.Fatalf("创建盘点: %+v %v", taskA, err)
	}
	taskB := &CmdbInventoryTask{Name: "项目 B 盘点"}
	taskBID, _ := s.CreateCmdbInventoryTaskForProject(scopeB, taskB)
	taskA.Name = "项目 A 盘点更新"
	if err := s.UpdateCmdbInventoryTaskForProject(scopeA, taskA); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCmdbInventoryTaskForProject(scopeA, taskBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("盘点删除越界: %v", err)
	}

	credA := &CmdbCredential{Name: "项目 A 凭据", AssetID: assetA}
	if _, err := s.CreateCmdbCredentialForProject(scopeA, credA); err != nil || credA.SyncID == "" {
		t.Fatalf("创建凭据: %+v %v", credA, err)
	}
	credB := &CmdbCredential{Name: "项目 B 凭据", AssetID: assetB}
	credBID, _ := s.CreateCmdbCredentialForProject(scopeB, credB)
	credA.Description = "更新"
	if err := s.UpdateCmdbCredentialForProject(scopeA, credA); err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateCmdbCredentialForProject(scopeA, &CmdbCredential{ID: credBID, Name: "越界", AssetID: assetA}); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("凭据更新越界: %v", err)
	}
	if err := s.DeleteCmdbCredentialForProject(scopeA, credBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("凭据删除越界: %v", err)
	}
}

func TestProjectScopeTaxonomyLabelsAndIPSubnetIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	parentA, _ := s.CreateCmdbTaxonomyForProject(scopeA, "orgs", "同名组织", 0, 1)
	parentB, _ := s.CreateCmdbTaxonomyForProject(scopeB, "orgs", "同名组织", 0, 1)
	childA, _ := s.CreateCmdbTaxonomyForProject(scopeA, "orgs", "下级", parentA, 1)
	if err := s.UpdateCmdbTaxonomyForProject(scopeA, "orgs", childA, "更新下级", parentB, 1); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("分类父节点越界: %v", err)
	}
	if err := s.DeleteCmdbTaxonomyForProject(scopeA, "orgs", parentB); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("分类删除越界: %v", err)
	}

	fieldA := &CustomField{FieldKey: "same_key", FieldName: "字段 A", FieldType: "text"}
	fieldB := &CustomField{FieldKey: "same_key", FieldName: "字段 B", FieldType: "text"}
	fieldAID, _ := s.SaveCustomFieldForProject(scopeA, fieldA)
	fieldBID, err := s.SaveCustomFieldForProject(scopeB, fieldB)
	if err != nil || fieldA.SyncID == "" || fieldB.SyncID == "" {
		t.Fatalf("跨项目同字段键失败: A=%+v B=%+v err=%v", fieldA, fieldB, err)
	}
	if _, err := s.GetCustomFieldForProject(scopeA, fieldBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("字段详情越界: %v", err)
	}
	if err := s.DeleteCustomFieldForProject(scopeA, fieldBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("字段删除越界: %v", err)
	}
	if _, err := s.GetCustomFieldForProject(scopeA, fieldAID); err != nil {
		t.Fatal(err)
	}

	assetA, _ := s.CreateCmdbAssetManualForProject(scopeA, &CmdbAsset{Name: "标签资产 A", AssetCode: "SAME-CODE"})
	assetB, _ := s.CreateCmdbAssetManualForProject(scopeB, &CmdbAsset{Name: "标签资产 B", AssetCode: "SAME-CODE"})
	if n, err := s.GenerateCmdbLabelsForProject(scopeA, "A"); err != nil || n != 1 {
		t.Fatalf("生成 A 标签: %d %v", n, err)
	}
	if n, err := s.GenerateCmdbLabelsForProject(scopeB, "B"); err != nil || n != 1 {
		t.Fatalf("生成 B 标签: %d %v", n, err)
	}
	labelsA, totalA, _ := s.QueryCmdbLabelsForProject(scopeA, "", "", 1, 20)
	labelsB, totalB, _ := s.QueryCmdbLabelsForProject(scopeB, "", "", 1, 20)
	if totalA != 1 || totalB != 1 || labelsA[0].AssetID != assetA || labelsB[0].AssetID != assetB || labelsA[0].ProjectID != scopeA.ProjectID {
		t.Fatalf("标签隔离失败: A=%+v B=%+v", labelsA, labelsB)
	}
	if n, err := s.MarkCmdbLabelsPrintedForProject(scopeA, []int64{labelsA[0].ID, labelsB[0].ID}, "batch-a"); !errors.Is(err, ErrProjectScopedNotFound) || n != 0 {
		t.Fatalf("批量打印必须整体拒绝越界 ID: %d %v", n, err)
	}
	if printed, err := s.QueryCmdbPrintedLabelsForProject(scopeA, 20); err != nil || len(printed) != 0 {
		t.Fatalf("批量打印越界后发生部分更新: %+v %v", printed, err)
	}
	if err := s.SetCmdbLabelStatusForProject(scopeA, labelsB[0].ID, "已归档"); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("标签状态越界: %v", err)
	}
	if err := s.SaveLabelCodePrefixForProject(scopeA, "PA"); err != nil {
		t.Fatal(err)
	}
	if prefix, _ := s.LabelCodePrefixForProject(scopeB); prefix != "ZC" {
		t.Fatalf("标签前缀跨项目: %s", prefix)
	}
	dashboardA, _ := s.CmdbDashboardDataForProject(scopeA)
	if dashboardA["total"].(int) != 1 {
		t.Fatalf("看板越界: %+v", dashboardA)
	}

	subnetA := &IPSubnet{Name: "同名网段", Category: "专网"}
	subnetAID, _ := s.CreateIPSubnetForProject(scopeA, subnetA)
	subnetB := &IPSubnet{Name: "同名网段", Category: "专网"}
	subnetBID, err := s.CreateIPSubnetForProject(scopeB, subnetB)
	if err != nil || subnetA.SyncID == "" || subnetB.SyncID == "" {
		t.Fatalf("跨项目同名网段失败: %v", err)
	}
	if _, err := s.db.Exec(`INSERT INTO ip_pool(project_id,ip,subnet,status) VALUES(?,?,?,'在用'),(?,?,?,'空闲')`, scopeA.ProjectID, "10.1.1.1", "同名网段", scopeB.ProjectID, "10.2.1.1", "同名网段"); err != nil {
		t.Fatal(err)
	}
	subnetsA, _ := s.ListIPSubnetsForProject(scopeA)
	if len(subnetsA) != 1 || subnetsA[0].Total != 1 || subnetsA[0].Used != 1 {
		t.Fatalf("网段统计越界: %+v", subnetsA)
	}
	subnetA.Name = "项目 A 新网段"
	if err := s.UpdateIPSubnetForProject(scopeA, subnetA); err != nil {
		t.Fatal(err)
	}
	var subnetBName string
	if err := s.db.QueryRow(`SELECT name FROM ip_subnets WHERE id=?`, subnetBID).Scan(&subnetBName); err != nil || subnetBName != "同名网段" {
		t.Fatalf("网段改名越界: %s %v", subnetBName, err)
	}
	if err := s.DeleteIPSubnetForProject(scopeA, subnetBID); !errors.Is(err, ErrProjectScopedNotFound) {
		t.Fatalf("网段删除越界: %v", err)
	}
	if _, err := s.GetIPSubnetForProject(scopeA, subnetAID); err != nil {
		t.Fatal(err)
	}
}

func TestProjectScopeConfigUniqueIndexesMigrateIdempotently(t *testing.T) {
	s := newCmdbTestStore(t)
	if err := MigrateProjectSchema(s.db); err != nil {
		t.Fatalf("重复迁移项目索引: %v", err)
	}
	oldIndexes := []string{
		"idx_cmdb_orgs_parent_name", "idx_cmdb_groups_parent_name", "idx_cmdb_categories_parent_name",
		"idx_cmdb_models_vendor_model", "idx_cmdb_labels_code", "idx_cmdb_assets_source",
		"idx_cmdb_cf_key", "idx_ip_subnets_name",
	}
	newIndexes := []string{
		"idx_cmdb_orgs_project_parent_name", "idx_cmdb_groups_project_parent_name", "idx_cmdb_categories_project_parent_name",
		"idx_cmdb_models_project_vendor_model", "idx_cmdb_labels_project_code", "idx_cmdb_assets_project_source",
		"idx_cmdb_cf_project_key", "idx_ip_subnets_project_name", "idx_ip_pool_project_ip",
	}
	for _, name := range oldIndexes {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, name).Scan(&count); err != nil || count != 0 {
			t.Fatalf("旧全局索引仍存在 %s: count=%d err=%v", name, count, err)
		}
	}
	for _, name := range newIndexes {
		var count int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?`, name).Scan(&count); err != nil || count != 1 {
			t.Fatalf("项目内索引缺失 %s: count=%d err=%v", name, count, err)
		}
	}
}

func TestProjectScopeCustomFieldLegacyUniqueConstraintMigrates(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "legacy-custom-fields.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defaultProject, err := s.DefaultProject()
	if err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
		DROP TABLE cmdb_custom_fields;
		CREATE TABLE cmdb_custom_fields (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			field_key TEXT NOT NULL UNIQUE,
			field_name TEXT NOT NULL,
			field_type TEXT NOT NULL,
			options_json TEXT,
			asset_class TEXT NOT NULL DEFAULT 'all',
			required INTEGER NOT NULL DEFAULT 0,
			show_in_list INTEGER NOT NULL DEFAULT 0,
			export_excel INTEGER NOT NULL DEFAULT 1,
			sort_order INTEGER NOT NULL DEFAULT 0,
			created_at TEXT,
			updated_at TEXT,
			project_id INTEGER,
			sync_id TEXT,
			revision INTEGER NOT NULL DEFAULT 1,
			deleted_at TEXT
		);
		CREATE UNIQUE INDEX idx_cmdb_cf_key ON cmdb_custom_fields(field_key);
		INSERT INTO cmdb_custom_fields (
			field_key, field_name, field_type, asset_class, project_id, sync_id, revision, updated_at
		) VALUES ('legacy_same', '旧字段', 'text', 'all', ?, 'legacy-field-sync', 1, '2026-09-17T00:00:00Z');
		UPDATE _meta SET v='1' WHERE k='project_schema_version';
	`, defaultProject.ID)
	if err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	upgraded, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	other, err := upgraded.CreateCmdbProject(&CmdbProject{Code: "legacy-other", Name: "旧库其他项目"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := upgraded.SaveCustomFieldForProject(
		ProjectScope{ProjectID: other.ID},
		&CustomField{FieldKey: "legacy_same", FieldName: "其他项目同键字段", FieldType: "text"},
	); err != nil {
		t.Fatalf("旧库升级后跨项目同字段键应可保存: %v", err)
	}
	if _, err := upgraded.SaveCustomFieldForProject(
		ProjectScope{ProjectID: other.ID},
		&CustomField{FieldKey: "legacy_same", FieldName: "同项目重复字段", FieldType: "text"},
	); err == nil {
		t.Fatal("旧库升级后同项目仍应拒绝重复字段键")
	}
}

func TestProjectScopeConfigDefaultCompatibility(t *testing.T) {
	s := newCmdbTestStore(t)
	defaultScope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	_, otherScope := newCmdbProjectScopes(t, s)

	defaultCategory, err := s.CreateCmdbTaxonomy("categories", "默认分类", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbTaxonomyForProject(otherScope, "categories", "其他分类", 0, 1); err != nil {
		t.Fatal(err)
	}
	if list, err := s.ListCmdbTaxonomy("categories"); err != nil || !taxonomyContainsID(list, defaultCategory) {
		t.Fatalf("旧分类 API 未限定默认项目: %+v %v", list, err)
	}

	defaultAsset, err := s.CreateCmdbAssetManual(&CmdbAsset{Name: "默认标签资产", AssetCode: "DEFAULT-LABEL"})
	if err != nil {
		t.Fatal(err)
	}
	otherAsset, err := s.CreateCmdbAssetManualForProject(otherScope, &CmdbAsset{Name: "其他标签资产", AssetCode: "OTHER-LABEL"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbWorkOrder(&CmdbWorkOrder{Subject: "默认工单", AssetID: defaultAsset}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateCmdbWorkOrderForProject(otherScope, &CmdbWorkOrder{Subject: "其他工单", AssetID: otherAsset}); err != nil {
		t.Fatal(err)
	}
	if rows, total, err := s.QueryCmdbWorkOrders(CmdbWorkOrderQuery{Page: 1, PageSize: 20}); err != nil || total != 1 || rows[0].ProjectID != defaultScope.ProjectID {
		t.Fatalf("旧工单 API 未限定默认项目: %+v %d %v", rows, total, err)
	}

	defaultField := &CustomField{FieldKey: "same_default", FieldName: "默认字段", FieldType: "text"}
	if _, err := s.SaveCustomField(defaultField); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveCustomFieldForProject(otherScope, &CustomField{FieldKey: "same_default", FieldName: "其他字段", FieldType: "text"}); err != nil {
		t.Fatal(err)
	}
	if fields, err := s.ListCustomFields("all"); err != nil || len(fields) != 1 || fields[0].ProjectID != defaultScope.ProjectID {
		t.Fatalf("旧字段 API 未限定默认项目: %+v %v", fields, err)
	}

	if _, err := s.CreateIPSubnet(&IPSubnet{Name: "默认网段"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateIPSubnetForProject(otherScope, &IPSubnet{Name: "其他网段"}); err != nil {
		t.Fatal(err)
	}
	if subnets, err := s.ListIPSubnets(); err != nil || len(subnets) != 1 || subnets[0].ProjectID != defaultScope.ProjectID {
		t.Fatalf("旧网段 API 未限定默认项目: %+v %v", subnets, err)
	}

	if n, err := s.GenerateCmdbLabels("D"); err != nil || n != 1 {
		t.Fatalf("旧标签生成 API 错误: %d %v", n, err)
	}
	if labels, total, err := s.QueryCmdbLabels("", "", 1, 20); err != nil || total != 1 || labels[0].AssetID != defaultAsset {
		t.Fatalf("旧标签 API 未限定默认项目: %+v %d %v", labels, total, err)
	}
	if labels, total, err := s.QueryCmdbLabelsForProject(otherScope, "", "", 1, 20); err != nil || total != 0 || len(labels) != 0 {
		t.Fatalf("旧标签生成污染其他项目: %+v %d %v", labels, total, err)
	}
	if dashboard, err := s.CmdbDashboardData(); err != nil || dashboard["total"].(int) != 1 {
		t.Fatalf("旧看板 API 未限定默认项目: %+v %v", dashboard, err)
	}
}
