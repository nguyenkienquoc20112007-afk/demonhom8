<?php
declare(strict_types=1);
require __DIR__ . '/db.php';

$perPage = int_param('per_page', 20, 5, 100);
$sort    = sort_param();
$domain  = domain_param();

$where  = $domain !== null ? 'WHERE domain = :domain' : '';
$params = $domain !== null ? [':domain' => $domain] : [];
$order  = $sort === 'top' ? 'points DESC, id DESC' : 'created_at DESC, id DESC';

[$total, $countMs] = timed(
    fn() => (int)run_query("SELECT COUNT(*) FROM stories $where", $params)->fetchColumn()
);

$totalPages = max(1, (int)ceil($total / $perPage));
$page       = min(int_param('page', 1, 1, 10000000), $totalPages);
$offset     = ($page - 1) * $perPage;

$sql = 'SELECT ' . story_columns() . " FROM stories $where ORDER BY $order LIMIT :limit OFFSET :offset";
[$rows, $queryMs] = timed(
    fn() => run_query($sql, $params + [':limit' => $perPage, ':offset' => $offset])->fetchAll()
);

json_out([
    'items'       => array_map('format_story', $rows),
    'page'        => $page,
    'per_page'    => $perPage,
    'total'       => $total,
    'total_pages' => $totalPages,
    'offset'      => $offset,
    'count_ms'    => $countMs,
    'query_ms'    => $queryMs,
    'sql'         => squash_sql(
        "SELECT ... FROM stories $where ORDER BY $order LIMIT $perPage OFFSET $offset"
    ),
]);
