import { ListRow } from "@/components/list-row"
import { NoteDot, WaitingDot } from "@/components/marks"
import { KIND_ICON } from "@/lib/kinds"
import { ago } from "@/lib/time"
import { type News, type Place, useNews } from "./where"

// The pieces of Home's rows that Recent and the projects' groups share

export const NewsDot = ({ news }: { news: News }) => (news.comment ? <WaitingDot /> : <NoteDot label={false} />)

// A place with something new since the user last looked (a digest, a finished reply, new papers, someone's
// edit) carries Owlit's dot in its icon's place, or the warning dot for comments, and says what where its
// time was, until the user has seen it there. detail: what follows the title, the place's own by default.
export function PlaceRow({ place, detail = place.detail, end = ago(place.at) }: { place: Place; detail?: string; end?: string }) {
  const news = useNews(place)
  return news ? (
    <ListRow to={place.to} mark={<NewsDot news={news} />} title={place.title} detail={detail} end={news.words} />
  ) : (
    <ListRow to={place.to} icon={KIND_ICON[place.kind]} title={place.title} detail={detail} end={end} />
  )
}
