package store

import (
	"database/sql"
	"fmt"
	"net/netip"
	"strings"
)

// IPSubnetSegment is a planned range within one address pool. The address ledger remains in ip_pool.
type IPSubnetSegment struct {
	ID       int64  `json:"id"`
	SubnetID int64  `json:"subnet_id"`
	Name     string `json:"name"`
	Floor    string `json:"floor"`
	StartIP  string `json:"start_ip"`
	EndIP    string `json:"end_ip"`
	Count    int    `json:"count"`
	Remark   string `json:"remark"`
	Total    int    `json:"total"`
	Used     int    `json:"used"`
	Reserved int    `json:"reserved"`
	Abnormal int    `json:"abnormal"`
	Free     int    `json:"free"`
}

const ipSubnetSegmentsSchema = `
CREATE TABLE IF NOT EXISTS ip_subnet_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    subnet_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    floor TEXT NOT NULL DEFAULT '',
    start_ip TEXT NOT NULL,
    end_ip TEXT NOT NULL,
    count INTEGER NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    sync_id TEXT,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT,
    updated_at TEXT,
    deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ip_subnet_segments_pool ON ip_subnet_segments(project_id, subnet_id);
`

func ipv4Number(addr netip.Addr) uint32 {
	a := addr.As4()
	return uint32(a[0])<<24 | uint32(a[1])<<16 | uint32(a[2])<<8 | uint32(a[3])
}

func validateIPSubnetSegments(cidr, prefix string, segments []IPSubnetSegment) error {
	if len(segments) == 0 {
		return nil
	}
	network, err := netip.ParsePrefix(normalizeSubnetCIDR(cidr, prefix))
	if err != nil || !network.Addr().Is4() {
		return fmt.Errorf("请先填写有效的 IPv4 地址池 CIDR，再维护分段")
	}
	previous := make([]struct {
		start, end uint32
		name       string
	}, 0, len(segments))
	for i := range segments {
		segment := &segments[i]
		segment.Name = strings.TrimSpace(segment.Name)
		segment.Floor = strings.TrimSpace(segment.Floor)
		segment.StartIP = strings.TrimSpace(segment.StartIP)
		segment.EndIP = strings.TrimSpace(segment.EndIP)
		if segment.Name == "" {
			return fmt.Errorf("第 %d 个分段名称不能为空", i+1)
		}
		start, startErr := netip.ParseAddr(segment.StartIP)
		end, endErr := netip.ParseAddr(segment.EndIP)
		if startErr != nil || endErr != nil || !start.Is4() || !end.Is4() || !network.Contains(start) || !network.Contains(end) {
			return fmt.Errorf("分段「%s」起止 IP 必须为地址池 CIDR 内的 IPv4 地址", segment.Name)
		}
		from, to := ipv4Number(start), ipv4Number(end)
		if from > to {
			return fmt.Errorf("分段「%s」起始 IP 不能大于结束 IP", segment.Name)
		}
		count := uint64(to) - uint64(from) + 1
		if count > uint64(^uint(0)>>1) {
			return fmt.Errorf("分段「%s」地址数量超过系统可表示范围", segment.Name)
		}
		if segment.Count != 0 && segment.Count != int(count) {
			return fmt.Errorf("分段「%s」数量应为 %d", segment.Name, count)
		}
		segment.Count = int(count)
		for _, other := range previous {
			if from <= other.end && other.start <= to {
				return fmt.Errorf("分段「%s」与「%s」地址区间重叠", segment.Name, other.name)
			}
		}
		previous = append(previous, struct {
			start, end uint32
			name       string
		}{from, to, segment.Name})
	}
	return nil
}

func replaceIPSubnetSegments(tx *sql.Tx, projectID, subnetID int64, segments []IPSubnetSegment) error {
	ids := make([]int64, 0, len(segments))
	seen := make(map[int64]bool, len(segments))
	for _, segment := range segments {
		if segment.ID < 0 {
			return fmt.Errorf("分段 ID 不能为负数")
		}
		if segment.ID == 0 {
			continue
		}
		if seen[segment.ID] {
			return fmt.Errorf("分段 ID %d 重复", segment.ID)
		}
		seen[segment.ID] = true
		ids = append(ids, segment.ID)
		res, err := tx.Exec(`UPDATE ip_subnet_segments SET name=?,floor=?,start_ip=?,end_ip=?,count=?,remark=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND project_id=? AND subnet_id=? AND (name<>? OR floor<>? OR start_ip<>? OR end_ip<>? OR count<>? OR remark<>?)`, segment.Name, segment.Floor, segment.StartIP, segment.EndIP, segment.Count, segment.Remark, segment.ID, projectID, subnetID, segment.Name, segment.Floor, segment.StartIP, segment.EndIP, segment.Count, segment.Remark)
		if err != nil {
			return err
		}
		if affected, _ := res.RowsAffected(); affected == 0 {
			var exists int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM ip_subnet_segments WHERE id=? AND project_id=? AND subnet_id=?`, segment.ID, projectID, subnetID).Scan(&exists); err != nil {
				return err
			}
			if exists == 0 {
				return fmt.Errorf("分段 %d 不属于当前地址池", segment.ID)
			}
		}
	}
	query := `DELETE FROM ip_subnet_segments WHERE project_id=? AND subnet_id=?`
	args := []interface{}{projectID, subnetID}
	if len(ids) > 0 {
		query += ` AND id NOT IN (` + strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",") + `)`
		for _, id := range ids {
			args = append(args, id)
		}
	}
	if _, err := tx.Exec(query, args...); err != nil {
		return err
	}
	for _, segment := range segments {
		if segment.ID > 0 {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO ip_subnet_segments(project_id,subnet_id,name,floor,start_ip,end_ip,count,remark) VALUES(?,?,?,?,?,?,?,?)`, projectID, subnetID, segment.Name, segment.Floor, segment.StartIP, segment.EndIP, segment.Count, segment.Remark); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) loadIPSubnetSegments(scope ProjectScope, subnets []IPSubnet) error {
	if len(subnets) == 0 {
		return nil
	}
	byID := make(map[int64]*IPSubnet, len(subnets))
	ids := make([]string, 0, len(subnets))
	args := make([]interface{}, 0, len(subnets)+1)
	args = append(args, scope.ProjectID)
	for i := range subnets {
		subnets[i].Segments = []IPSubnetSegment{}
		if subnets[i].ID <= 0 {
			continue
		}
		byID[subnets[i].ID] = &subnets[i]
		ids = append(ids, "?")
		args = append(args, subnets[i].ID)
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := s.db.Query(`SELECT id,subnet_id,name,floor,start_ip,end_ip,count,remark FROM ip_subnet_segments WHERE project_id=? AND subnet_id IN (`+strings.Join(ids, ",")+`) ORDER BY subnet_id,id`, args...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var segment IPSubnetSegment
		if err := rows.Scan(&segment.ID, &segment.SubnetID, &segment.Name, &segment.Floor, &segment.StartIP, &segment.EndIP, &segment.Count, &segment.Remark); err != nil {
			rows.Close()
			return err
		}
		if subnet := byID[segment.SubnetID]; subnet != nil {
			subnet.Segments = append(subnet.Segments, segment)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	return s.attachSegmentStats(scope, subnets)
}

func (s *Store) attachSegmentStats(scope ProjectScope, subnets []IPSubnet) error {
	byName := make(map[string]*IPSubnet, len(subnets))
	for i := range subnets {
		byName[subnets[i].Name] = &subnets[i]
		for j := range subnets[i].Segments {
			segment := &subnets[i].Segments[j]
			start, end := netip.MustParseAddr(segment.StartIP), netip.MustParseAddr(segment.EndIP)
			_, usableStart, usableEnd, ok := usableIPv4Range(normalizeSubnetCIDR(subnets[i].CIDR, subnets[i].Prefix))
			if ok {
				from, to := max(ipv4Number(start), ipv4Number(usableStart)), min(ipv4Number(end), ipv4Number(usableEnd))
				if from <= to {
					segment.Total = int(to-from) + 1
				}
			}
			segment.Free = segment.Total
		}
	}
	anySegments := false
	for _, subnet := range subnets {
		if len(subnet.Segments) > 0 {
			anySegments = true
			break
		}
	}
	if !anySegments {
		return nil
	}
	rows, err := s.db.Query(`SELECT subnet,ip,IFNULL(status,'') FROM ip_pool WHERE project_id=?`, scope.ProjectID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name, address, status string
		if err := rows.Scan(&name, &address, &status); err != nil {
			return err
		}
		subnet := byName[name]
		if subnet == nil {
			continue
		}
		ip, err := netip.ParseAddr(address)
		if err != nil || !ip.Is4() || specialIPv4Address(normalizeSubnetCIDR(subnet.CIDR, subnet.Prefix), address) != "" {
			continue
		}
		value := ipv4Number(ip)
		for j := range subnet.Segments {
			segment := &subnet.Segments[j]
			if value < ipv4Number(netip.MustParseAddr(segment.StartIP)) || value > ipv4Number(netip.MustParseAddr(segment.EndIP)) {
				continue
			}
			switch {
			case isIPUsedStatus(status):
				segment.Used++
			case status == "保留":
				segment.Reserved++
			case status == "不可用" || status == "冲突" || status == "异常":
				segment.Abnormal++
			}
			break
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for i := range subnets {
		for j := range subnets[i].Segments {
			segment := &subnets[i].Segments[j]
			segment.Free = max(0, segment.Total-segment.Used-segment.Reserved-segment.Abnormal)
		}
	}
	return nil
}

func (s *Store) IPSubnetSegmentForProject(scope ProjectScope, subnetName string, segmentID int64) (*IPSubnetSegment, error) {
	var segment IPSubnetSegment
	err := s.db.QueryRow(`SELECT g.id,g.subnet_id,g.name,g.floor,g.start_ip,g.end_ip,g.count,g.remark FROM ip_subnet_segments g JOIN ip_subnets n ON n.id=g.subnet_id AND n.project_id=g.project_id WHERE g.project_id=? AND n.name=? AND g.id=?`, scope.ProjectID, subnetName, segmentID).Scan(&segment.ID, &segment.SubnetID, &segment.Name, &segment.Floor, &segment.StartIP, &segment.EndIP, &segment.Count, &segment.Remark)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("分段不属于当前地址池")
	}
	return &segment, err
}

func segmentForIP(segments []IPSubnetSegment, address string) *IPSubnetSegment {
	addr, err := netip.ParseAddr(address)
	if err != nil || !addr.Is4() {
		return nil
	}
	value := ipv4Number(addr)
	for i := range segments {
		if value >= ipv4Number(netip.MustParseAddr(segments[i].StartIP)) && value <= ipv4Number(netip.MustParseAddr(segments[i].EndIP)) {
			return &segments[i]
		}
	}
	return nil
}

func (s *Store) attachIPSegments(scope ProjectScope, entries []IPEntry) error {
	if len(entries) == 0 {
		return nil
	}
	defs, err := s.ListIPSubnetsForProject(scope)
	if err != nil {
		return err
	}
	byName := make(map[string][]IPSubnetSegment, len(defs))
	for _, def := range defs {
		byName[def.Name] = def.Segments
	}
	for i := range entries {
		if segment := segmentForIP(byName[entries[i].Subnet], entries[i].IP); segment != nil {
			entries[i].SegmentID, entries[i].SegmentName, entries[i].SegmentFloor = segment.ID, segment.Name, segment.Floor
		}
	}
	return nil
}

// IPv4 values use padded octets so SQL range filters preserve numeric order.
const ipSegmentOrderExpr = `printf('%03d.%03d.%03d.%03d',
 CAST(json_extract(CASE WHEN json_valid('['||replace(ip_pool.ip,'.',',')||']') THEN '['||replace(ip_pool.ip,'.',',')||']' ELSE '[]' END,'$[0]') AS INTEGER),
 CAST(json_extract(CASE WHEN json_valid('['||replace(ip_pool.ip,'.',',')||']') THEN '['||replace(ip_pool.ip,'.',',')||']' ELSE '[]' END,'$[1]') AS INTEGER),
 CAST(json_extract(CASE WHEN json_valid('['||replace(ip_pool.ip,'.',',')||']') THEN '['||replace(ip_pool.ip,'.',',')||']' ELSE '[]' END,'$[2]') AS INTEGER),
 CAST(json_extract(CASE WHEN json_valid('['||replace(ip_pool.ip,'.',',')||']') THEN '['||replace(ip_pool.ip,'.',',')||']' ELSE '[]' END,'$[3]') AS INTEGER))`

func segmentSortKey(value string) string {
	ip := netip.MustParseAddr(value).As4()
	return fmt.Sprintf("%03d.%03d.%03d.%03d", ip[0], ip[1], ip[2], ip[3])
}

// ValidateIPEntrySegmentsForProject checks optional segment columns without changing the legacy ledger schema.
func (s *Store) ValidateIPEntrySegmentsForProject(scope ProjectScope, entries []IPEntry) error {
	defs, err := s.ListIPSubnetsForProject(scope)
	if err != nil {
		return err
	}
	byName := make(map[string][]IPSubnetSegment, len(defs))
	for _, def := range defs {
		byName[def.Name] = def.Segments
	}
	for _, entry := range entries {
		if entry.SegmentName == "" && entry.SegmentFloor == "" {
			continue
		}
		segment := segmentForIP(byName[entry.Subnet], entry.IP)
		if segment == nil || (entry.SegmentName != "" && segment.Name != entry.SegmentName) || (entry.SegmentFloor != "" && segment.Floor != entry.SegmentFloor) {
			return fmt.Errorf("IP %s 的分段与地址池「%s」已保存的区间不一致", entry.IP, entry.Subnet)
		}
	}
	return nil
}
