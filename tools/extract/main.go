package main

import (
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/xuri/excelize/v2"
)

type ColSpec struct {
	Field  string
	Col    int  // 0-based column index
	IsDate bool
}

type TableSpec struct {
	Key    string
	Name   string
	Group  string
	File   string
	Sheet  string
	Header int // 0-based header row index; -1 means no header
	Cols   []ColSpec
}

const (
	F1 = "常州中院-云桌面帐号及IP规划.xlsx"
	F2 = "中院云桌面资产标签.xlsx"
)

var tables = []TableSpec{
	// ---- 资产台账 ----
	{Key: "dengji", Name: "登记", Group: "资产台账", File: F2, Sheet: "登记", Header: 0, Cols: []ColSpec{
		{Field: "资产编码", Col: 0}, {Field: "显示器SN", Col: 1}, {Field: "盒子SN", Col: 2},
		{Field: "显示器SN前缀", Col: 3}, {Field: "显示器SN后4位", Col: 4}, {Field: "盒子SN前缀", Col: 5},
		{Field: "盒子SN后5位", Col: 6}, {Field: "房间", Col: 7}, {Field: "安元软件情况", Col: 8},
		{Field: "业务IP", Col: 9}, {Field: "姓名", Col: 10}, {Field: "备注", Col: 11}, {Field: "更新日期", Col: 12},
	}},
	{Key: "hezi", Name: "盒子登记", Group: "资产台账", File: F2, Sheet: "盒子登记", Header: 0, Cols: []ColSpec{
		{Field: "SN", Col: 0}, {Field: "状态", Col: 1}, {Field: "位置", Col: 2}, {Field: "登记用户", Col: 3},
		{Field: "上次记录接入时间", Col: 4}, {Field: "最后终端IP", Col: 5}, {Field: "虚拟机IP", Col: 6},
		{Field: "内外网", Col: 7}, {Field: "备注", Col: 8}, {Field: "重复", Col: 9},
	}},
	{Key: "xianshi", Name: "显示器登记", Group: "资产台账", File: F2, Sheet: "显示器登记", Header: 0, Cols: []ColSpec{
		{Field: "显示器SN", Col: 0}, {Field: "状态", Col: 1}, {Field: "位置", Col: 2}, {Field: "用户", Col: 3},
		{Field: "备注", Col: 4}, {Field: "重复", Col: 5},
	}},
	{Key: "weixiu", Name: "维修替换", Group: "资产台账", File: F2, Sheet: "维修替换", Header: 0, Cols: []ColSpec{
		{Field: "类型", Col: 0}, {Field: "原SN", Col: 1}, {Field: "新SN", Col: 2},
		{Field: "出库时间", Col: 3, IsDate: true}, {Field: "入库时间", Col: 4, IsDate: true},
	}},
	{Key: "huishou", Name: "云桌面回收", Group: "资产台账", File: F2, Sheet: "云桌面回收", Header: 0, Cols: []ColSpec{
		{Field: "虚拟机用户", Col: 0}, {Field: "IP", Col: 1}, {Field: "更换时间", Col: 2, IsDate: true},
		{Field: "IP是否占用", Col: 3}, {Field: "备注", Col: 4},
	}},
	{Key: "laodalou", Name: "从老大楼拿回的屏", Group: "资产台账", File: F2, Sheet: "从老大楼拿回的屏20145", Header: 0, Cols: []ColSpec{
		{Field: "编号", Col: 0}, {Field: "房间", Col: 1}, {Field: "姓名", Col: 2}, {Field: "位置", Col: 3},
	}},
	// ---- IP规划 ----
	{Key: "zw7", Name: "专网7段", Group: "IP规划", File: F1, Sheet: "专网7段", Header: 0, Cols: []ColSpec{
		{Field: "序号", Col: 0}, {Field: "部门", Col: 1}, {Field: "IP", Col: 2}, {Field: "帐号", Col: 3}, {Field: "备注", Col: 4},
	}},
	{Key: "zw8", Name: "专网8段", Group: "IP规划", File: F1, Sheet: "专网8段", Header: 0, Cols: []ColSpec{
		{Field: "序号", Col: 0}, {Field: "部门", Col: 1}, {Field: "IP", Col: 2}, {Field: "帐号", Col: 3}, {Field: "备注", Col: 4},
	}},
	{Key: "zw9", Name: "专网9段", Group: "IP规划", File: F1, Sheet: "专网9段", Header: 0, Cols: []ColSpec{
		{Field: "序号", Col: 0}, {Field: "部门", Col: 1}, {Field: "IP", Col: 2}, {Field: "房间", Col: 3},
		{Field: "帐号", Col: 4}, {Field: "添加日期", Col: 5}, {Field: "备注", Col: 6},
	}},
	{Key: "zw10", Name: "专网10段", Group: "IP规划", File: F1, Sheet: "专网10段", Header: 0, Cols: []ColSpec{
		{Field: "序号", Col: 0}, {Field: "部门", Col: 1}, {Field: "IP", Col: 2}, {Field: "帐号", Col: 3},
		{Field: "密码", Col: 4}, {Field: "备注", Col: 5},
	}},
	{Key: "heziip", Name: "专网盒子IP", Group: "IP规划", File: F1, Sheet: "专网盒子IP", Header: 1, Cols: []ColSpec{
		{Field: "序号", Col: 0}, {Field: "IP地址", Col: 1}, {Field: "房间", Col: 2}, {Field: "VLAN", Col: 3},
		{Field: "备注", Col: 4}, {Field: "备注2", Col: 6},
	}},
	{Key: "waiwang", Name: "外网IP", Group: "IP规划", File: F1, Sheet: "外网 IP", Header: 1, Cols: []ColSpec{
		{Field: "序号", Col: 0}, {Field: "盒子地址", Col: 1}, {Field: "业务地址", Col: 2}, {Field: "部门", Col: 3},
		{Field: "房间", Col: 4}, {Field: "使用人员", Col: 5}, {Field: "位置", Col: 6},
	}},
	{Key: "fating", Name: "法庭房间查询", Group: "IP规划", File: F1, Sheet: "法庭房间查询", Header: 0, Cols: []ColSpec{
		{Field: "法庭号", Col: 3}, {Field: "房间", Col: 4},
	}},
	{Key: "guihua", Name: "专网规划", Group: "IP规划", File: F1, Sheet: "专网规划", Header: 0, Cols: []ColSpec{
		{Field: "楼层", Col: 0}, {Field: "部门", Col: 1}, {Field: "楼层说明", Col: 2}, {Field: "用户数量", Col: 3}, {Field: "网段规划", Col: 4},
	}},
	{Key: "anyuan", Name: "未安装安元的法庭", Group: "IP规划", File: F1, Sheet: "未安装安元的法庭", Header: -1, Cols: []ColSpec{
		{Field: "描述", Col: 0}, {Field: "法庭", Col: 1}, {Field: "法庭号", Col: 3}, {Field: "编号", Col: 4},
	}},
}

func convertDate(s string) string {
	if s == "" {
		return ""
	}
	t, err := time.Parse("01-02-06", s)
	if err != nil {
		return s
	}
	return t.Format("2006-01-02")
}

func isRowEmpty(row []string) bool {
	for _, v := range row {
		if v != "" {
			return false
		}
	}
	return true
}

type Table struct {
	Key     string              `json:"key"`
	Name    string              `json:"name"`
	Group   string              `json:"group"`
	Columns []string            `json:"columns"`
	Rows    []map[string]string `json:"rows"`
}

func main() {
	type fileHandle struct {
		path string
		f    *excelize.File
	}
	handles := map[string]*excelize.File{}
	for _, p := range []string{F1, F2} {
		f, err := excelize.OpenFile(p)
		if err != nil {
			fmt.Fprintln(os.Stderr, "open err:", p, err)
			os.Exit(1)
		}
		handles[p] = f
	}
	for _, f := range handles {
		defer f.Close()
	}

	var out []Table
	for _, ts := range tables {
		f := handles[ts.File]
		rows, err := f.GetRows(ts.Sheet)
		if err != nil {
			fmt.Fprintln(os.Stderr, "rows err:", ts.Sheet, err)
			os.Exit(1)
		}
		cols := make([]string, len(ts.Cols))
		for i, c := range ts.Cols {
			cols[i] = c.Field
		}
		t := Table{Key: ts.Key, Name: ts.Name, Group: ts.Group, Columns: cols, Rows: []map[string]string{}}

		start := 0
		if ts.Header >= 0 {
			start = ts.Header + 1
		}
		for r := start; r < len(rows); r++ {
			row := rows[r]
			if isRowEmpty(row) {
				continue
			}
			m := map[string]string{}
			for _, c := range ts.Cols {
				v := ""
				if c.Col < len(row) {
					v = row[c.Col]
				}
				if c.IsDate {
					v = convertDate(v)
				}
				m[c.Field] = v
			}
			t.Rows = append(t.Rows, m)
		}
		out = append(out, t)
		fmt.Printf("%-8s %-12s %d 行\n", ts.Key, ts.Name, len(t.Rows))
	}

	data := map[string]interface{}{"version": 1, "tables": out}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, "marshal err:", err)
		os.Exit(1)
	}
	if err := os.MkdirAll("seed", 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "mkdir err:", err)
		os.Exit(1)
	}
	if err := os.WriteFile("seed/seed.json", b, 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "write err:", err)
		os.Exit(1)
	}
	fmt.Println("written seed/seed.json", len(b), "bytes")
}
