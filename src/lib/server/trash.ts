/** Removes the attached files of records that leave the recycle bin for good. */
export async function purgeFiles(db: any, rows: { id: string; section: string }[]) {
  const st = db.storage.from("files");
  for (const r of rows) {
    const prefix = `${r.section}/${r.id}`;
    const { data } = await st.list(prefix, { limit: 1000 });
    const paths = (data || []).filter((o: any) => o.id).map((o: any) => `${prefix}/${o.name}`);
    if (paths.length) await st.remove(paths);
  }
}

/** Daily: records deleted more than 30 days ago leave the recycle bin with their files. */
export async function purgeOld(db: any, days = 30) {
  const before = new Date(Date.now() - days * 864e5).toISOString();
  const { data } = await db.from("records_trash").select("id,section").lt("deleted_at", before).limit(500);
  if (!data?.length) return { purged: 0 };
  await purgeFiles(db, data);
  await db.from("records_trash").delete().in("id", data.map((r: any) => r.id));
  return { purged: data.length };
}
