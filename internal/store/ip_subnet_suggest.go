package store

import (
	"fmt"
	"net"
	"sort"
	"strings"
)

// SubnetSuggestion 是资产 IP 尚未被任何已定义网段覆盖的 /24 段，供 IPAM 确认后建网段。
type SubnetSuggestion struct {
	Prefix  string   `json:"prefix"`
	CIDR    string   `json:"cidr"`
	Count   int      `json:"count"`
	Samples []string `json:"samples"`
	Sources []string `json:"sources"`
}

// UncoveredAssetSubnetsForProject 汇总终端、基础设施、接口和业务系统的 IPv4 地址，
// 剔除已被网段 CIDR 覆盖的地址后按 /24 分组；网络类别不推断，由用户确认。
func (s *Store) UncoveredAssetSubnetsForProject(scope ProjectScope) ([]SubnetSuggestion, error) {
	if _, err := s.ResolveProject(scope); err != nil {
		return nil, err
	}
	var networks []*net.IPNet
	subnetRows, err := s.db.Query(`SELECT IFNULL(cidr,''), IFNULL(prefix,'') FROM ip_subnets WHERE project_id=?`, scope.ProjectID)
	if err != nil {
		return nil, err
	}
	for subnetRows.Next() {
		var cidr, prefix string
		if err := subnetRows.Scan(&cidr, &prefix); err != nil {
			subnetRows.Close()
			return nil, err
		}
		cidr = strings.TrimSpace(cidr)
		if cidr == "" && strings.TrimSpace(prefix) != "" {
			cidr = strings.TrimSpace(prefix) + ".0/24"
		}
		if _, network, err := net.ParseCIDR(cidr); err == nil {
			networks = append(networks, network)
		}
	}
	if err := subnetRows.Err(); err != nil {
		subnetRows.Close()
		return nil, err
	}
	subnetRows.Close()
	sources := []struct {
		label string
		query string
	}{
		{"终端资产", `SELECT ip FROM assets WHERE project_id=?1 UNION ALL SELECT terminal_ip FROM assets WHERE project_id=?1`},
		{"基础设施", `SELECT mgmt_ip FROM cmdb_assets WHERE project_id=?1 UNION ALL SELECT biz_ip FROM cmdb_assets WHERE project_id=?1`},
		{"网络接口", `SELECT ip FROM cmdb_asset_interfaces WHERE project_id=?1`},
		{"业务系统", `SELECT service_ip FROM server_apps WHERE project_id=?1`},
	}
	type bucket struct {
		ips     map[string]struct{}
		sources map[string]struct{}
	}
	buckets := map[string]*bucket{}
	for _, source := range sources {
		rows, err := s.db.Query(source.query, scope.ProjectID)
		if err != nil {
			return nil, fmt.Errorf("读取%s IP 失败: %w", source.label, err)
		}
		for rows.Next() {
			var raw *string
			if err := rows.Scan(&raw); err != nil {
				rows.Close()
				return nil, err
			}
			if raw == nil {
				continue
			}
			ip := net.ParseIP(strings.TrimSpace(*raw)).To4()
			if ip == nil || ip.IsUnspecified() || ip.IsLoopback() {
				continue
			}
			covered := false
			for _, network := range networks {
				if network.Contains(ip) {
					covered = true
					break
				}
			}
			if covered {
				continue
			}
			prefix := fmt.Sprintf("%d.%d.%d", ip[0], ip[1], ip[2])
			item := buckets[prefix]
			if item == nil {
				item = &bucket{ips: map[string]struct{}{}, sources: map[string]struct{}{}}
				buckets[prefix] = item
			}
			item.ips[ip.String()] = struct{}{}
			item.sources[source.label] = struct{}{}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}

	out := make([]SubnetSuggestion, 0, len(buckets))
	for prefix, item := range buckets {
		ips := make([]string, 0, len(item.ips))
		for ip := range item.ips {
			ips = append(ips, ip)
		}
		sort.Slice(ips, func(i, j int) bool { return ipv4Less(ips[i], ips[j]) })
		samples := ips
		if len(samples) > 3 {
			samples = samples[:3]
		}
		labels := make([]string, 0, len(item.sources))
		for label := range item.sources {
			labels = append(labels, label)
		}
		sort.Strings(labels)
		out = append(out, SubnetSuggestion{Prefix: prefix, CIDR: prefix + ".0/24", Count: len(ips), Samples: samples, Sources: labels})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return ipv4Less(out[i].Prefix+".0", out[j].Prefix+".0")
	})
	return out, nil
}

func ipv4Less(left, right string) bool {
	a, b := net.ParseIP(left).To4(), net.ParseIP(right).To4()
	if a == nil || b == nil {
		return left < right
	}
	for index := range a {
		if a[index] != b[index] {
			return a[index] < b[index]
		}
	}
	return false
}
