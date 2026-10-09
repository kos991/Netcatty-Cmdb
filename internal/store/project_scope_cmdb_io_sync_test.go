package store

import (
	"bytes"
	"testing"

	"github.com/xuri/excelize/v2"
)

func buildProjectCmdbImport(t *testing.T, name, assetCode, category, osType string) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	row := []string{name, assetCode, "在线", category, "SN-" + assetCode, "厂商", "型号", "", "", "", "", "", "", osType}
	for i, header := range cmdbImportColumns {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		if err := f.SetCellValue("Sheet1", cell, header); err != nil {
			t.Fatal(err)
		}
	}
	for i, value := range row {
		cell, _ := excelize.CoordinatesToCellName(i+1, 2)
		if err := f.SetCellValue("Sheet1", cell, value); err != nil {
			t.Fatal(err)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func buildProjectSangforImport(t *testing.T) []byte {
	t.Helper()
	f := excelize.NewFile()
	defer f.Close()
	f.SetSheetName("Sheet1", "互联网云桌面")
	for _, sheet := range []string{"专网云桌面", "互联网超融合", "防火墙", "准入", "管理", "其它管理平台"} {
		if _, err := f.NewSheet(sheet); err != nil {
			t.Fatal(err)
		}
	}
	connection := []interface{}{"业务", "节点A", "机房A", "1", "", "节点B", "机房B", "2"}
	for i, value := range connection {
		cell, _ := excelize.CoordinatesToCellName(i+1, 3)
		if err := f.SetCellValue("互联网云桌面", cell, value); err != nil {
			t.Fatal(err)
		}
	}
	management := []interface{}{"", "节点A管理", "https://10.0.0.1", "admin/secret", "管理入口"}
	for i, value := range management {
		cell, _ := excelize.CoordinatesToCellName(i+1, 3)
		if err := f.SetCellValue("管理", cell, value); err != nil {
			t.Fatal(err)
		}
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestProjectScopeCmdbIOIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	categoryA, err := s.CreateCmdbTaxonomyForProject(scopeA, "categories", "同名分类", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	categoryB, err := s.CreateCmdbTaxonomyForProject(scopeB, "categories", "同名分类", 0, 1)
	if err != nil {
		t.Fatal(err)
	}

	importA := buildProjectCmdbImport(t, "项目 A 导入资产", "IO-A", "同名分类", "Linux-A")
	importB := buildProjectCmdbImport(t, "项目 B 导入资产", "IO-B", "同名分类", "Linux-B")
	if result, err := s.PreviewCmdbImportForProject(scopeA, bytes.NewReader(importA)); err != nil || result.Valid != 1 {
		t.Fatalf("项目 A 导入预览失败: result=%+v err=%v", result, err)
	}
	if result, err := s.CommitCmdbImportForProject(scopeA, bytes.NewReader(importA)); err != nil || result.Created != 1 {
		t.Fatalf("项目 A 导入失败: result=%+v err=%v", result, err)
	}
	if result, err := s.CommitCmdbImportForProject(scopeB, bytes.NewReader(importB)); err != nil || result.Created != 1 {
		t.Fatalf("项目 B 导入失败: result=%+v err=%v", result, err)
	}
	if _, err := s.db.Exec(`UPDATE cmdb_assets SET room='项目 A 机房' WHERE project_id=?`, scopeA.ProjectID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`UPDATE cmdb_assets SET room='项目 B 机房' WHERE project_id=?`, scopeB.ProjectID); err != nil {
		t.Fatal(err)
	}

	assetsA, err := s.AllCmdbAssetsForProject(scopeA, CmdbAssetQuery{})
	if err != nil || len(assetsA) != 1 || assetsA[0].ProjectID != scopeA.ProjectID || assetsA[0].CategoryID != categoryA {
		t.Fatalf("项目 A 导出隔离失败: assets=%+v err=%v", assetsA, err)
	}
	assetsB, err := s.AllCmdbAssetsForProject(scopeB, CmdbAssetQuery{})
	if err != nil || len(assetsB) != 1 || assetsB[0].ProjectID != scopeB.ProjectID || assetsB[0].CategoryID != categoryB {
		t.Fatalf("项目 B 导出隔离失败: assets=%+v err=%v", assetsB, err)
	}
	optsA, err := s.CmdbAssetFilterOptionsForProject(scopeA)
	if err != nil || len(optsA["os_type"]) != 1 || optsA["os_type"][0] != "Linux-A" {
		t.Fatalf("项目 A 筛选项越界: opts=%+v err=%v", optsA, err)
	}
	if len(optsA["location"]) != 1 || optsA["location"][0] != "项目 A 机房" {
		t.Fatalf("项目 A 位置筛选项越界: opts=%+v", optsA)
	}
	optsB, err := s.CmdbAssetFilterOptionsForProject(scopeB)
	if err != nil || len(optsB["os_type"]) != 1 || optsB["os_type"][0] != "Linux-B" {
		t.Fatalf("项目 B 筛选项越界: opts=%+v err=%v", optsB, err)
	}
	if len(optsB["location"]) != 1 || optsB["location"][0] != "项目 B 机房" {
		t.Fatalf("项目 B 位置筛选项越界: opts=%+v", optsB)
	}
}

func TestProjectScopeLegacySyncIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	for _, fixture := range []struct {
		scope ProjectScope
		code  string
	}{
		{scope: scopeA, code: "A"},
		{scope: scopeB, code: "B"},
	} {
		if _, err := s.CreateAssetForProject(fixture.scope, &Asset{
			AssetCode: "ASSET-" + fixture.code, UserName: "用户" + fixture.code,
			Department: "部门" + fixture.code, IP: "10.0." + fixture.code + ".10", Status: "在用",
		}, "测试"); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateServerForProject(fixture.scope, &PhysicalServer{
			AssetCode: "SERVER-" + fixture.code, DeviceName: "服务器" + fixture.code,
			BizIP: "10.1." + fixture.code + ".10", Status: "运行中",
		}, "测试"); err != nil {
			t.Fatal(err)
		}
	}

	firstA, err := s.SyncLegacyToCmdbForProject(scopeA)
	if err != nil || firstA.AssetInserted != 1 || firstA.ServerInserted != 1 {
		t.Fatalf("项目 A 同步失败: result=%+v err=%v", firstA, err)
	}
	if rows, total, err := s.QueryCmdbAssetsForProject(scopeB, CmdbAssetQuery{Page: 1, PageSize: 20}); err != nil || total != 0 || len(rows) != 0 {
		t.Fatalf("项目 A 同步写入项目 B: rows=%+v total=%d err=%v", rows, total, err)
	}
	firstB, err := s.SyncLegacyToCmdbForProject(scopeB)
	if err != nil || firstB.AssetInserted != 1 || firstB.ServerInserted != 1 {
		t.Fatalf("项目 B 同步失败: result=%+v err=%v", firstB, err)
	}
	secondA, err := s.SyncLegacyToCmdbForProject(scopeA)
	if err != nil || secondA.AssetInserted != 0 || secondA.ServerInserted != 0 || secondA.Skipped != 2 {
		t.Fatalf("项目 A 二次同步不幂等: result=%+v err=%v", secondA, err)
	}
	for _, scope := range []ProjectScope{scopeA, scopeB} {
		var interfaceCount int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_asset_interfaces WHERE project_id=?`, scope.ProjectID).Scan(&interfaceCount); err != nil || interfaceCount != 2 {
			t.Fatalf("项目 %d 网络接口归属错误: count=%d err=%v", scope.ProjectID, interfaceCount, err)
		}
	}
}

func TestProjectScopeSangforImportIsolation(t *testing.T) {
	s := newCmdbTestStore(t)
	scopeA, scopeB := newCmdbProjectScopes(t, s)
	data := buildProjectSangforImport(t)

	for _, scope := range []ProjectScope{scopeA, scopeB} {
		result, err := s.CommitSangforImportForProject(scope, bytes.NewReader(data))
		if err != nil || result.ServersCreated != 2 || result.AppsCreated != 1 || result.HiddenSecrets != 1 {
			t.Fatalf("项目 %d 深信服导入失败: result=%+v err=%v", scope.ProjectID, result, err)
		}
	}
	for _, scope := range []ProjectScope{scopeA, scopeB} {
		var servers, apps int
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM servers WHERE project_id=?`, scope.ProjectID).Scan(&servers); err != nil {
			t.Fatal(err)
		}
		if err := s.db.QueryRow(`SELECT COUNT(*) FROM server_apps WHERE project_id=?`, scope.ProjectID).Scan(&apps); err != nil {
			t.Fatal(err)
		}
		if servers != 2 || apps != 1 {
			t.Fatalf("项目 %d 深信服数据归属错误: servers=%d apps=%d", scope.ProjectID, servers, apps)
		}
	}
	previewA, err := s.PreviewSangforImportForProject(scopeA, bytes.NewReader(data))
	if err != nil || previewA.ServersUpdated != 2 || previewA.AppsUpdated != 1 || previewA.ServersCreated != 0 || previewA.AppsCreated != 0 {
		t.Fatalf("项目 A 预览未限定本项目: result=%+v err=%v", previewA, err)
	}
	defaultResult, err := s.CommitSangforImport(bytes.NewReader(data))
	if err != nil || defaultResult.ServersCreated != 2 || defaultResult.AppsCreated != 1 {
		t.Fatalf("默认项目兼容导入失败: result=%+v err=%v", defaultResult, err)
	}
	defaultScope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	var defaultServers, defaultApps int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM servers WHERE project_id=?`, defaultScope.ProjectID).Scan(&defaultServers); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM server_apps WHERE project_id=?`, defaultScope.ProjectID).Scan(&defaultApps); err != nil {
		t.Fatal(err)
	}
	if defaultServers != 2 || defaultApps != 1 {
		t.Fatalf("旧深信服 API 未限定默认项目: servers=%d apps=%d", defaultServers, defaultApps)
	}
}
