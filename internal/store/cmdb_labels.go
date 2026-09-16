package store

import (
	"math"
	"strings"
	"time"
)

// ============================ 编码与标签 ============================

// CmdbLabel 编码注册表条目。资产信息通过 asset_id 关联 cmdb_assets，不重复存储。
type CmdbLabel struct {
	ID         int64  `json:"id"`
	Code       string `json:"code"`
	AssetID    int64  `json:"asset_id"`
	AssetName  string `json:"asset_name"`
	SN         string `json:"sn"`
	Department string `json:"department"`
	Owner      string `json:"owner"`
	AssetCode  string `json:"asset_code"`
	Status     string `json:"status"` // 派生值：使用中 / 孤儿 / 已归档
	Printed    int64  `json:"printed"`
	PrintBatch string `json:"print_batch"`
	CreatedAt  string `json:"created_at"`
}

const cmdbLabelSelect = `SELECT l.id, l.code, l.asset_id, IFNULL(a.name,''), IFNULL(a.sn,''),
	IFNULL(a.department,''), IFNULL(a.owner,''), IFNULL(a.asset_code,''),
	CASE WHEN l.status='已归档' THEN '已归档' WHEN a.id IS NULL THEN '孤儿' ELSE '使用中' END,
	l.printed, IFNULL(l.print_batch,''), IFNULL(l.created_at,'')
	FROM cmdb_labels l LEFT JOIN cmdb_assets a ON a.id = l.asset_id`

// 页签条件与 nettopo 实测的「全部 / 使用中 / 孤儿 / 已归档」一致。
func cmdbLabelTabClause(tab string) string {
	switch tab {
	case "使用中":
		return " WHERE l.status = '使用中' AND a.id IS NOT NULL"
	case "孤儿":
		return " WHERE l.status <> '已归档' AND a.id IS NULL"
	case "已归档":
		return " WHERE l.status = '已归档'"
	default:
		return ""
	}
}

func (s *Store) QueryCmdbLabels(tab, keyword string, page, pageSize int) ([]CmdbLabel, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 500 {
		pageSize = 10
	}
	clause := cmdbLabelTabClause(tab)
	var args []interface{}
	if kw := strings.TrimSpace(keyword); kw != "" {
		pat := "%" + kw + "%"
		conn := " AND "
		if clause == "" {
			conn = " WHERE "
		}
		clause += conn + `(l.code LIKE ? OR IFNULL(a.name,'') LIKE ? OR IFNULL(a.sn,'') LIKE ?
			OR IFNULL(a.department,'') LIKE ? OR IFNULL(a.owner,'') LIKE ? OR IFNULL(a.asset_code,'') LIKE ?)`
		args = append(args, pat, pat, pat, pat, pat, pat)
	}

	var total int
	countSQL := `SELECT COUNT(*) FROM cmdb_labels l LEFT JOIN cmdb_assets a ON a.id = l.asset_id` + clause
	if err := s.db.QueryRow(countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.db.Query(cmdbLabelSelect+clause+" ORDER BY l.id DESC LIMIT ? OFFSET ?",
		append(append([]interface{}{}, args...), pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	list := make([]CmdbLabel, 0, pageSize)
	for rows.Next() {
		var v CmdbLabel
		if err := rows.Scan(&v.ID, &v.Code, &v.AssetID, &v.AssetName, &v.SN, &v.Department,
			&v.Owner, &v.AssetCode, &v.Status, &v.Printed, &v.PrintBatch, &v.CreatedAt); err != nil {
			return nil, 0, err
		}
		list = append(list, v)
	}
	return list, total, rows.Err()
}

// QueryCmdbPrintedLabels 返回已打印的编码记录，用于「打印审计」。
func (s *Store) QueryCmdbPrintedLabels(limit int) ([]CmdbLabel, error) {
	if limit < 1 || limit > 1000 {
		limit = 200
	}
	rows, err := s.db.Query(cmdbLabelSelect+` WHERE l.printed = 1 ORDER BY l.updated_at DESC, l.id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := make([]CmdbLabel, 0, limit)
	for rows.Next() {
		var v CmdbLabel
		if err := rows.Scan(&v.ID, &v.Code, &v.AssetID, &v.AssetName, &v.SN, &v.Department,
			&v.Owner, &v.AssetCode, &v.Status, &v.Printed, &v.PrintBatch, &v.CreatedAt); err != nil {
			return nil, err
		}
		list = append(list, v)
	}
	return list, rows.Err()
}

func (s *Store) CountOrphanCmdbLabels() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_labels l
		LEFT JOIN cmdb_assets a ON a.id = l.asset_id
		WHERE l.status <> '已归档' AND a.id IS NULL`).Scan(&n)
	return n, err
}

// LabelCodePrefix 读取编码规则中的前缀（存于 _meta，默认 ZC）。
func (s *Store) LabelCodePrefix() (string, error) {
	var v string
	err := s.db.QueryRow(`SELECT v FROM _meta WHERE k='cmdb_label_prefix'`).Scan(&v)
	if err != nil {
		return "ZC", nil
	}
	if strings.TrimSpace(v) == "" {
		return "ZC", nil
	}
	return v, nil
}

func (s *Store) SaveLabelCodePrefix(prefix string) error {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		return nil
	}
	_, err := s.db.Exec(`INSERT INTO _meta(k,v) VALUES('cmdb_label_prefix',?)
		ON CONFLICT(k) DO UPDATE SET v=excluded.v`, prefix)
	return err
}

// GenerateCmdbLabels 为尚无编码的资产批量生成编码并登记，返回新增条数。
// 资产已有 asset_code 时直接采用，否则用「前缀-资产ID」生成。
func (s *Store) GenerateCmdbLabels(prefix string) (int, error) {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "ZC"
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	res, err := s.db.Exec(`
		INSERT OR IGNORE INTO cmdb_labels (code, asset_id, status, created_at, updated_at)
		SELECT CASE WHEN IFNULL(a.asset_code,'') <> '' THEN a.asset_code ELSE ? || '-' || a.id END,
		       a.id, '使用中', ?, ?
		FROM cmdb_assets a
		WHERE NOT EXISTS (SELECT 1 FROM cmdb_labels l WHERE l.asset_id = a.id)`,
		prefix, now, now)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// RepairOrphanCmdbLabels 先按编码回填资产关联，仍无法关联的转为已归档，返回处理条数。
func (s *Store) RepairOrphanCmdbLabels() (int, error) {
	now := time.Now().Format("2006-01-02 15:04:05")

	res, err := s.db.Exec(`
		UPDATE cmdb_labels SET asset_id = (
			SELECT a.id FROM cmdb_assets a WHERE a.asset_code = cmdb_labels.code LIMIT 1
		), updated_at = ?
		WHERE (asset_id = 0 OR asset_id NOT IN (SELECT id FROM cmdb_assets))
		  AND EXISTS (SELECT 1 FROM cmdb_assets a WHERE a.asset_code = cmdb_labels.code)`, now)
	if err != nil {
		return 0, err
	}
	linked, _ := res.RowsAffected()

	res2, err := s.db.Exec(`
		UPDATE cmdb_labels SET status = '已归档', updated_at = ?
		WHERE status <> '已归档'
		  AND (asset_id = 0 OR asset_id NOT IN (SELECT id FROM cmdb_assets))`, now)
	if err != nil {
		return 0, err
	}
	archived, _ := res2.RowsAffected()

	return int(linked + archived), nil
}

func (s *Store) SetCmdbLabelStatus(id int64, status string) error {
	now := time.Now().Format("2006-01-02 15:04:05")
	_, err := s.db.Exec(`UPDATE cmdb_labels SET status=?, updated_at=? WHERE id=?`, status, now, id)
	return err
}

func (s *Store) DeleteCmdbLabel(id int64) error {
	_, err := s.db.Exec(`DELETE FROM cmdb_labels WHERE id=?`, id)
	return err
}

// MarkCmdbLabelsPrinted 记录一批标签的打印，返回更新条数。
func (s *Store) MarkCmdbLabelsPrinted(ids []int64, batch string) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	holders := make([]string, len(ids))
	args := []interface{}{1, batch, now}
	for i, id := range ids {
		holders[i] = "?"
		args = append(args, id)
	}
	q := `UPDATE cmdb_labels SET printed=?, print_batch=?, updated_at=? WHERE id IN (` +
		strings.Join(holders, ",") + `)`
	res, err := s.db.Exec(q, args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

// ============================ CMDB 仪表盘 ============================

type CmdbCountItem struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

// CmdbDashboardData 汇总仪表盘 8 个区块所需的真实数据。
func (s *Store) CmdbDashboardData() (map[string]interface{}, error) {
	out := map[string]interface{}{}

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets`).Scan(&total); err != nil {
		return nil, err
	}
	out["total"] = total

	// 状态分布 + 健康率
	statusCounts := map[string]int{}
	rows, err := s.db.Query(`SELECT IFNULL(status,''), COUNT(*) FROM cmdb_assets GROUP BY status`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var name string
		var n int
		if err := rows.Scan(&name, &n); err != nil {
			rows.Close()
			return nil, err
		}
		statusCounts[name] = n
	}
	rows.Close()
	out["status_counts"] = statusCounts

	online := statusCounts["在线"]
	attentionCount := statusCounts["离线"] + statusCounts["故障"] + statusCounts["维护中"]
	rate := 0.0
	attentionRate := 0.0
	if total > 0 {
		rate = math.Round(float64(online)/float64(total)*1000) / 10
		attentionRate = math.Round(float64(attentionCount)/float64(total)*1000) / 10
	}
	out["health_rate"] = rate
	out["attention_rate"] = attentionRate
	out["attention_count"] = attentionCount

	// 最近新增资产
	recent, _, err := s.QueryCmdbAssets(CmdbAssetQuery{Page: 1, PageSize: 5, SortBy: "", SortOrder: "desc"})
	if err != nil {
		return nil, err
	}
	out["recent_assets"] = recent

	// 设备地理分布（仅有省份/城市的数据）
	geo := make([]CmdbCountItem, 0, 8)
	geoRows, err := s.db.Query(`SELECT CASE WHEN IFNULL(province,'') <> '' THEN province ELSE city END AS area,
		COUNT(*) FROM cmdb_assets WHERE IFNULL(province,'') <> '' OR IFNULL(city,'') <> ''
		GROUP BY area ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	for geoRows.Next() {
		var item CmdbCountItem
		if err := geoRows.Scan(&item.Name, &item.Count); err != nil {
			geoRows.Close()
			return nil, err
		}
		geo = append(geo, item)
	}
	geoRows.Close()
	out["geo_dist"] = geo

	// 设备分类分布
	// 注意：别名不能叫 name，否则与 cmdb_assets.name 冲突（ambiguous column name）。
	cats := make([]CmdbCountItem, 0, 8)
	catRows, err := s.db.Query(`SELECT CASE WHEN IFNULL(c.name,'') = '' THEN '未分类' ELSE c.name END AS grp_name,
		COUNT(*) FROM cmdb_assets a LEFT JOIN cmdb_device_categories c ON c.id = a.category_id
		GROUP BY grp_name ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	for catRows.Next() {
		var item CmdbCountItem
		if err := catRows.Scan(&item.Name, &item.Count); err != nil {
			catRows.Close()
			return nil, err
		}
		cats = append(cats, item)
	}
	catRows.Close()
	out["category_dist"] = cats

	// 部门资产分布
	depts := make([]CmdbCountItem, 0, 16)
	deptRows, err := s.db.Query(`SELECT CASE WHEN IFNULL(department,'') = '' THEN '未分配部门' ELSE department END AS grp_name,
		COUNT(*) FROM cmdb_assets GROUP BY grp_name ORDER BY COUNT(*) DESC`)
	if err != nil {
		return nil, err
	}
	for deptRows.Next() {
		var item CmdbCountItem
		if err := deptRows.Scan(&item.Name, &item.Count); err != nil {
			deptRows.Close()
			return nil, err
		}
		depts = append(depts, item)
	}
	deptRows.Close()
	out["department_dist"] = depts

	// 异常设备关注
	abnormal, _, err := s.QueryCmdbAssets(CmdbAssetQuery{Status: "离线", Page: 1, PageSize: 5})
	if err != nil {
		return nil, err
	}
	faults, _, err := s.QueryCmdbAssets(CmdbAssetQuery{Status: "故障", Page: 1, PageSize: 5})
	if err != nil {
		return nil, err
	}
	out["abnormal_devices"] = append(abnormal, faults...)

	// 即将过保（90 天内到期）
	var expiring int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM cmdb_assets
		WHERE IFNULL(warranty_date,'') <> ''
		  AND warranty_date >= date('now')
		  AND warranty_date <= date('now','+90 day')`).Scan(&expiring); err != nil {
		return nil, err
	}
	out["expiring_count"] = expiring

	// 最新工单动态
	orders, orderTotal, err := s.QueryCmdbWorkOrders(CmdbWorkOrderQuery{Page: 1, PageSize: 5})
	if err != nil {
		return nil, err
	}
	out["recent_work_orders"] = orders
	out["work_order_total"] = orderTotal

	return out, nil
}
