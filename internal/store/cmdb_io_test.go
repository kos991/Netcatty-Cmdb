package store

import (
	"bytes"
	"strings"
	"testing"

	"github.com/xuri/excelize/v2"
)

func TestCmdbAssetFilterOptionsAndExportAll(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "A", AssetCode: "ZC-1", Status: "在线", OSType: "Linux", OSVersion: "openEuler 22.03"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "B", AssetCode: "ZC-2", Status: "在库", OSType: "Linux", OSVersion: "Kylin V10"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "C", AssetCode: "ZC-3", Status: "在线"})

	opts, err := s.CmdbAssetFilterOptions()
	if err != nil {
		t.Fatalf("取筛选值失败: %v", err)
	}
	if len(opts["os_type"]) != 1 || opts["os_type"][0] != "Linux" {
		t.Fatalf("os_type 可选值应为 [Linux]，实际 %v", opts["os_type"])
	}
	if len(opts["os_version"]) != 2 {
		t.Fatalf("os_version 应有 2 个值，实际 %v", opts["os_version"])
	}

	// 导出取全量，不受分页限制
	all, err := s.AllCmdbAssets(CmdbAssetQuery{})
	if err != nil {
		t.Fatalf("导出查询失败: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("应导出 3 条，实际 %d", len(all))
	}
	// 带筛选
	filtered, err := s.AllCmdbAssets(CmdbAssetQuery{OSType: "Linux"})
	if err != nil {
		t.Fatalf("筛选导出失败: %v", err)
	}
	if len(filtered) != 2 {
		t.Fatalf("按 OS 类型筛选应导出 2 条，实际 %d", len(filtered))
	}
	// 分页查询同样支持 os_type / os_version / mgmt_ip
	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{OSVersion: "Kylin V10", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 1 || list[0].Name != "B" {
		t.Fatalf("按 OS 版本过滤结果错误: total=%d %+v", total, list)
	}
}

func TestCmdbAssetFilterOptionsOnlyExposeInfrastructureDeviceTypes(t *testing.T) {
	s := newCmdbTestStore(t)
	insertCmdbAsset(t, s, CmdbAsset{Name: "核心交换机", DeviceType: "switch"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "云桌面平台", DeviceType: "cloud_desktop"})
	insertCmdbAsset(t, s, CmdbAsset{Name: "办公终端", DeviceType: "台式电脑"})

	opts, err := s.CmdbAssetFilterOptions()
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"cloud_desktop", "switch"}
	if len(opts["device_type"]) != len(want) {
		t.Fatalf("基础设施设备类型选项不应混入终端类型: got=%v want=%v", opts["device_type"], want)
	}
	for i := range want {
		if opts["device_type"][i] != want[i] {
			t.Fatalf("基础设施设备类型选项错误: got=%v want=%v", opts["device_type"], want)
		}
	}
}

func TestCmdbImportTemplateRoundTrip(t *testing.T) {
	s := newCmdbTestStore(t)

	// 模板必须能被自己的导入解析（证明下载模板与批量导入是一对）
	tpl, err := BuildCmdbImportTemplate()
	if err != nil {
		t.Fatalf("生成模板失败: %v", err)
	}
	preview, err := s.PreviewCmdbImport(bytes.NewReader(tpl))
	if err != nil {
		t.Fatalf("模板无法被导入解析: %v", err)
	}
	if preview.Total != 1 || preview.Valid != 1 {
		t.Fatalf("模板示例行应可导入: total=%d valid=%d", preview.Total, preview.Valid)
	}
	// 示例里的分类/组织/分组在空库里不存在 → 应给出提示而不是失败
	if !strings.Contains(preview.Rows[0].Message, "不存在") {
		t.Fatalf("不存在的分类应给出提示，实际: %s", preview.Rows[0].Message)
	}

	commit, err := s.CommitCmdbImport(bytes.NewReader(tpl))
	if err != nil {
		t.Fatalf("提交导入失败: %v", err)
	}
	if commit.Created != 1 {
		t.Fatalf("应写入 1 条，实际 %d", commit.Created)
	}
	list, total, err := s.QueryCmdbAssets(CmdbAssetQuery{Keyword: "测试交换机", Page: 1, PageSize: 10})
	if err != nil {
		t.Fatalf("查询失败: %v", err)
	}
	if total != 1 || list[0].Name != "测试交换机" || list[0].SourceType != "manual" {
		t.Fatalf("导入结果不正确: %+v", list)
	}
	// 旧模板没有设备类型；导入后的未分类记录也必须能在原生基础设施中查到和导出。
	query := CmdbAssetQuery{ResourceScope: "infrastructure", OSType: "Linux", Page: 1, PageSize: 20}
	visible, count, err := s.QueryCmdbAssets(query)
	if err != nil || count != 1 || len(visible) != 1 || visible[0].ID != list[0].ID {
		t.Fatalf("基础设施未显示刚导入的记录: total=%d list=%+v err=%v", count, visible, err)
	}
	exported, err := s.AllCmdbAssets(query)
	if err != nil || len(exported) != 1 || exported[0].ID != list[0].ID {
		t.Fatalf("基础设施导出遗漏导入记录: list=%+v err=%v", exported, err)
	}
}

func TestCmdbImportValidatesRows(t *testing.T) {
	s := newCmdbTestStore(t)

	build := func(rows [][]string) *bytes.Reader {
		f := excelize.NewFile()
		defer f.Close()
		for ri, row := range rows {
			for ci, v := range row {
				cell, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
				_ = f.SetCellValue("Sheet1", cell, v)
			}
		}
		buf, _ := f.WriteToBuffer()
		return bytes.NewReader(buf.Bytes())
	}

	// 缺表头
	if _, err := s.PreviewCmdbImport(build([][]string{{"随便", "列"}})); err == nil {
		t.Fatalf("表头缺少资产名称时必须报错")
	}
	// 空名称行应被标记为无效
	res, err := s.PreviewCmdbImport(build([][]string{
		{"资产名称", "资产编号", "状态"},
		{"", "ZC-X", "在线"},
		{"有效设备", "ZC-Y", "在线"},
	}))
	if err != nil {
		t.Fatalf("预览失败: %v", err)
	}
	if res.Total != 2 || res.Valid != 1 {
		t.Fatalf("应 2 行、1 行有效，实际 total=%d valid=%d", res.Total, res.Valid)
	}
	if res.Rows[0].Valid || res.Rows[0].Message == "" {
		t.Fatalf("空名称行应无效且有说明: %+v", res.Rows[0])
	}
}
