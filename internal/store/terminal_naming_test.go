package store

import "testing"

func terminalPrefix(t *testing.T, s *Store, scope ProjectScope, code string) string {
	t.Helper()
	project, err := s.ResolveProject(scope)
	if err != nil {
		t.Fatal(err)
	}
	return project.Name + "-" + code + "-"
}

// 新增终端未填名称时必须按「项目-简称-流水号」生成，手工名称保持不变，流水号按简称独立递增。
func TestCreateTerminalAssignsProjectShortCodeSequence(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	vdi := terminalPrefix(t, s, scope, "VDI")
	create := func(a Asset) Asset {
		t.Helper()
		id, err := s.CreateAssetForProject(scope, &a, "测试")
		if err != nil {
			t.Fatal(err)
		}
		got, _, err := s.GetAssetForProject(scope, id)
		if err != nil {
			t.Fatal(err)
		}
		return *got
	}
	if got := create(Asset{DeviceType: "云桌面终端", Status: "在用"}); got.AssetName != vdi+"0001" {
		t.Fatalf("首台云桌面名称错误: %q", got.AssetName)
	}
	if got := create(Asset{AssetName: "领导办公室打印机", DeviceType: "打印机", Status: "在用"}); got.AssetName != "领导办公室打印机" {
		t.Fatalf("手工名称被覆盖: %q", got.AssetName)
	}
	if got := create(Asset{DeviceType: "打印机", Status: "在用"}); got.AssetName != terminalPrefix(t, s, scope, "PRT")+"0001" {
		t.Fatalf("打印机应独立编号: %q", got.AssetName)
	}
	if got := create(Asset{DeviceType: "云桌面终端", Status: "在用"}); got.AssetName != vdi+"0002" {
		t.Fatalf("云桌面流水号未递增: %q", got.AssetName)
	}
}

// 类型配置了简称时优先于关键字推断；批量补全只处理空名称且预览与写入一致。
func TestTerminalNameBackfillUsesConfiguredShortCode(t *testing.T) {
	s := newCmdbTestStore(t)
	scope, err := s.DefaultProjectScope()
	if err != nil {
		t.Fatal(err)
	}
	var categoryID int64
	if err := s.db.QueryRow(`SELECT id FROM cmdb_device_categories WHERE project_id=? AND asset_scope='terminal' AND name='云桌面终端'`, scope.ProjectID).Scan(&categoryID); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTerminalCategoryShortCodeForProject(scope, categoryID, "yzm"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetTerminalCategoryShortCodeForProject(scope, categoryID, "云桌面"); err == nil {
		t.Fatal("非字母数字简称必须拒绝")
	}
	if _, err := s.db.Exec(`INSERT INTO assets(project_id,asset_name,device_type,status) VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?)`,
		scope.ProjectID, "", "云桌面终端", "在用",
		scope.ProjectID, "已命名终端", "云桌面终端", "在用",
		scope.ProjectID, "", "云桌面终端", "在用"); err != nil {
		t.Fatal(err)
	}
	prefix := terminalPrefix(t, s, scope, "YZM")
	preview, err := s.PreviewTerminalNameBackfillForProject(scope)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview) != 2 || preview[0].Name != prefix+"0001" || preview[1].Name != prefix+"0002" {
		t.Fatalf("预览结果错误: %+v", preview)
	}
	count, err := s.ApplyTerminalNameBackfillForProject(scope)
	if err != nil || count != 2 {
		t.Fatalf("补全数量错误: %d %v", count, err)
	}
	var names []string
	rows, err := s.db.Query(`SELECT asset_name FROM assets WHERE project_id=? ORDER BY id`, scope.ProjectID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if len(names) != 3 || names[0] != prefix+"0001" || names[1] != "已命名终端" || names[2] != prefix+"0002" {
		t.Fatalf("补全写入错误: %v", names)
	}
	if again, err := s.PreviewTerminalNameBackfillForProject(scope); err != nil || len(again) != 0 {
		t.Fatalf("补全后不应再有待命名终端: %+v %v", again, err)
	}
}
