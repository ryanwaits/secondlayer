export function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="section-heading-wrap" id={id}>
      <hr />
      <h2 className="section-heading">{children}</h2>
    </div>
  );
}
