export const won = (value: number | null | undefined) =>
  `${Number(value ?? 0).toLocaleString("ko-KR")}원`;

export const orderNo = (value: number) => String(value).padStart(3, "0");

export const shortTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const fullTime = (value: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
