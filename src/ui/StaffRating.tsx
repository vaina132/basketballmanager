export function StaffStars({ rating }: { rating: number }) {
  return <span className="coach-rating" role="img" aria-label={`${rating / 2} out of 5 stars`}>
    <span className="coach-stars" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span className="coach-star" key={index}><span>☆</span><span className="coach-star-fill" style={{ width: `${Math.max(0, Math.min(2, rating - index * 2)) * 50}%` }}>★</span></span>)}</span>
    <span className="coach-rating-number" aria-hidden="true">{(rating / 2).toFixed(1)}</span>
  </span>
}

