package store

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
)

func TestCmdbCategoryScopesAreIsolated(t *testing.T) {
	s := newCmdbTestStore(t)

	terminalID, err := s.CreateCmdbTaxonomy("terminal-categories", "通用设备", 0, 1)
	if err != nil {
		t.Fatalf("新增终端资产分类失败: %v", err)
	}
	infrastructureID, err := s.CreateCmdbTaxonomy("infrastructure-categories", "通用设备", 0, 1)
	if err != nil {
		t.Fatalf("新增基础设施分类失败: %v", err)
	}
	applicationID, err := s.CreateCmdbTaxonomy("application-categories", "通用设备", 0, 1)
	if err != nil {
		t.Fatalf("新增业务系统分类失败: %v", err)
	}

	for _, tc := range []struct {
		kind string
		want int64
	}{
		{kind: "terminal-categories", want: terminalID},
		{kind: "infrastructure-categories", want: infrastructureID},
		{kind: "application-categories", want: applicationID},
	} {
		list, err := s.ListCmdbTaxonomy(tc.kind)
		if err != nil {
			t.Fatalf("查询 %s 失败: %v", tc.kind, err)
		}
		if len(list) != 1 || list[0].ID != tc.want {
			t.Fatalf("%s 应只返回自己的分类，实际 %+v", tc.kind, list)
		}
	}

	if _, err := s.CreateCmdbTaxonomy("terminal-categories", "错误子类", infrastructureID, 2); err == nil {
		t.Fatal("终端分类不能挂到基础设施分类下")
	}
}

func TestCmdbCategoryRenameSynchronizesTerminalAndApplicationTypes(t *testing.T) {
	s := newCmdbTestStore(t)

	terminalCategoryID, err := s.CreateCmdbTaxonomy("terminal-categories", "台式电脑", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	terminalID, err := s.CreateAsset(&Asset{AssetCode: "PC-TAXONOMY", DeviceType: "台式电脑", Status: "在用"}, "测试")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateCmdbTaxonomy("terminal-categories", terminalCategoryID, "办公终端", 0, 1); err != nil {
		t.Fatalf("重命名终端分类失败: %v", err)
	}
	terminal, _, err := s.GetAsset(terminalID)
	if err != nil {
		t.Fatal(err)
	}
	if terminal.DeviceType != "办公终端" {
		t.Fatalf("终端资产类型没有随分类重命名同步: %q", terminal.DeviceType)
	}

	applicationCategoryID, err := s.CreateCmdbTaxonomy("application-categories", "业务应用", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	applicationID, err := s.CreateApp(&ServerApp{AppName: "审判系统", AppType: "业务应用", Status: "正常运行"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateCmdbTaxonomy("application-categories", applicationCategoryID, "核心业务系统", 0, 1); err != nil {
		t.Fatalf("重命名业务系统分类失败: %v", err)
	}
	applications, total, err := s.QueryAllApps("审判系统", "", "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(applications) != 1 || applications[0].ID != applicationID || applications[0].AppType != "核心业务系统" {
		t.Fatalf("业务系统类型没有随分类重命名同步: total=%d list=%+v", total, applications)
	}
}

func TestCmdbCategoryDeleteIsBlockedByTerminalAndApplicationReferences(t *testing.T) {
	s := newCmdbTestStore(t)

	terminalCategoryID, err := s.CreateCmdbTaxonomy("terminal-categories", "笔记本", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAsset(&Asset{AssetCode: "NB-TAXONOMY", DeviceType: "笔记本", Status: "在用"}, "测试"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCmdbTaxonomy("terminal-categories", terminalCategoryID); err == nil {
		t.Fatal("被终端资产引用的分类必须拒绝删除")
	}

	applicationCategoryID, err := s.CreateCmdbTaxonomy("application-categories", "数据库服务", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateApp(&ServerApp{AppName: "数据平台", AppType: "数据库服务", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteCmdbTaxonomy("application-categories", applicationCategoryID); err == nil {
		t.Fatal("被业务系统引用的分类必须拒绝删除")
	}
}

func TestCmdbAssetGroupIsSharedByAllAssetKinds(t *testing.T) {
	s := newCmdbTestStore(t)
	groupID, err := s.CreateCmdbTaxonomy("groups", "核心生产区", 0, 1)
	if err != nil {
		t.Fatal(err)
	}

	var terminal Asset
	if err := json.Unmarshal([]byte(`{"asset_code":"PC-GROUP","device_type":"台式电脑","status":"在用","group_id":`+fmtInt(groupID)+`}`), &terminal); err != nil {
		t.Fatal(err)
	}
	terminalID, err := s.CreateAsset(&terminal, "测试")
	if err != nil {
		t.Fatal(err)
	}
	var terminalGroupID int64
	if err := s.db.QueryRow(`SELECT group_id FROM assets WHERE id=?`, terminalID).Scan(&terminalGroupID); err != nil {
		t.Fatalf("终端资产没有持久化资产分组: %v", err)
	}
	if terminalGroupID != groupID {
		t.Fatalf("终端资产分组错误: got=%d want=%d", terminalGroupID, groupID)
	}

	var application ServerApp
	if err := json.Unmarshal([]byte(`{"app_name":"审判系统","app_type":"业务应用","status":"正常运行","group_id":`+fmtInt(groupID)+`}`), &application); err != nil {
		t.Fatal(err)
	}
	applicationID, err := s.CreateApp(&application)
	if err != nil {
		t.Fatal(err)
	}
	var applicationGroupID int64
	if err := s.db.QueryRow(`SELECT group_id FROM server_apps WHERE id=?`, applicationID).Scan(&applicationGroupID); err != nil {
		t.Fatalf("业务系统没有持久化资产分组: %v", err)
	}
	if applicationGroupID != groupID {
		t.Fatalf("业务系统分组错误: got=%d want=%d", applicationGroupID, groupID)
	}

	insertCmdbAsset(t, s, CmdbAsset{Name: "核心服务器", AssetCode: "SRV-GROUP", Status: "在线", GroupID: groupID})
	groups, err := s.ListCmdbTaxonomy("groups")
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 || groups[0].AssetCount != 3 {
		t.Fatalf("资产分组应汇总三类资产引用，实际 %+v", groups)
	}
	if err := s.DeleteCmdbTaxonomy("groups", groupID); err == nil {
		t.Fatal("被任一类资产引用的资产分组必须拒绝删除")
	}
}

func TestCmdbInfrastructureQueryReturnsSharedGroupName(t *testing.T) {
	s := newCmdbTestStore(t)
	groupID, err := s.CreateCmdbTaxonomy("groups", "核心生产区", 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	insertCmdbAsset(t, s, CmdbAsset{Name: "核心交换机", AssetCode: "SW-GROUP", Status: "在线", DeviceType: "switch", GroupID: groupID})

	assets, total, err := s.QueryCmdbAssets(CmdbAssetQuery{ResourceScope: "infrastructure", Page: 1, PageSize: 20})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 || len(assets) != 1 {
		t.Fatalf("基础设施查询结果数量错误: total=%d list=%+v", total, assets)
	}
	if assets[0].GroupID != groupID || assets[0].GroupName != "核心生产区" {
		t.Fatalf("基础设施列表没有返回共享分组名称: groupID=%d groupName=%q", assets[0].GroupID, assets[0].GroupName)
	}
}

func fmtInt(value int64) string {
	return fmt.Sprintf("%d", value)
}

func TestCmdbCategoryMigrationBackfillsExistingTerminalAndApplicationTypes(t *testing.T) {
	databasePath := filepath.Join(t.TempDir(), "taxonomy-backfill.db")
	s, err := Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateAsset(&Asset{AssetCode: "PC-BACKFILL", DeviceType: "国产终端", Status: "在用"}, "测试"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateApp(&ServerApp{AppName: "统一门户", AppType: "门户系统", Status: "正常运行"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	s, err = Open(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	terminals, err := s.ListCmdbTaxonomy("terminal-categories")
	if err != nil {
		t.Fatal(err)
	}
	applications, err := s.ListCmdbTaxonomy("application-categories")
	if err != nil {
		t.Fatal(err)
	}
	if len(terminals) != 1 || terminals[0].Name != "国产终端" || terminals[0].AssetCount != 1 {
		t.Fatalf("存量终端类型没有回填为可管理分类: %+v", terminals)
	}
	if len(applications) != 1 || applications[0].Name != "门户系统" || applications[0].AssetCount != 1 {
		t.Fatalf("存量业务系统类型没有回填为可管理分类: %+v", applications)
	}
}
