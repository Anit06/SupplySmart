import { useState } from "react";
import {
  FaPhoneAlt,
  FaEnvelope,
  FaMapMarkerAlt,
  FaChevronDown,
} from "react-icons/fa";
import "../../../assets/css/support.css"; // Adjust path to match your project folder structure

function Support() {
  const [activeFaq, setActiveFaq] = useState(null);

  const faqs = [
    {
      id: 1,
      question: "How can I track my order status?",
      answer:
        "You can track your order in real-time by navigating to 'Order History' in your account or using the Quick Track feature above with your Order ID.",
    },
    {
      id: 2,
      question: "What is your return and refund policy?",
      answer:
        "We offer a 7-day hassle-free return policy for unused items in original packaging. Refunds are processed within 3-5 business days after inspection.",
    },
    {
      id: 3,
      question: "What payment methods do you accept?",
      answer:
        "We accept Cash on Delivery (COD), UPI (GPay, PhonePe, Paytm), Credit/Debit Cards, and Net Banking across major banks.",
    },
    {
      id: 4,
      question: "How do I modify or cancel my order?",
      answer:
        "Orders can be cancelled or modified within 1 hour of placing them via the Order History page or by contacting our live support team.",
    },
  ];

  const toggleFaq = (id) => {
    setActiveFaq(activeFaq === id ? null : id);
  };

  return (
    <div className="support-container">
      {/* Hero Banner */}
      <section className="support-hero">
        <div className="hero-content">
          <p className="hero-eyebrow">Customer Service</p>
          <h1>How can we help you today?</h1>
          <p className="hero-subtext">
            Have a question about an order, delivery, or return? We are here to
            support you 24/7.
          </p>
        </div>
      </section>

      {/* Main Form & Info Section */}
      <div className="support-main-grid">
        {/* Contact Info Sidebar */}
        <aside className="support-sidebar">
          <div className="support-card info-card">
            <h2>Direct Contact Info</h2>
            <p className="info-desc">
              Reach out directly via email, phone, or visit our headquarters.
            </p>

            <div className="contact-item">
              <div className="info-icon">
                <FaPhoneAlt />
              </div>
              <div>
                <h4>Toll-Free Support</h4>
                <p>+91 1800-123-4567</p>
                <span className="timing">Mon - Sat (9:00 AM - 8:00 PM)</span>
              </div>
            </div>

            <div className="contact-item">
              <div className="info-icon">
                <FaEnvelope />
              </div>
              <div>
                <h4>Email Us</h4>
                <p>support@ecommerce.com</p>
                <span className="timing">Response within 24 hours</span>
              </div>
            </div>

            <div className="contact-item">
              <div className="info-icon">
                <FaMapMarkerAlt />
              </div>
              <div>
                <h4>Corporate Office</h4>
                <p>
                  Baner–Aundh Link Road, Baner, Pune, Maharashtra, India, 411045
                </p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Frequently Asked Questions */}
      <section className="faq-section">
        <div className="section-header">
          <h2>Frequently Asked Questions</h2>
        </div>

        <div className="faq-list">
          {faqs.map((faq) => (
            <div
              key={faq.id}
              className={`faq-item ${activeFaq === faq.id ? "active" : ""}`}
              onClick={() => toggleFaq(faq.id)}
            >
              <div className="faq-question">
                <h3>{faq.question}</h3>
                <FaChevronDown
                  className={`chevron-icon ${activeFaq === faq.id ? "rotate" : ""}`}
                />
              </div>
              {activeFaq === faq.id && (
                <div className="faq-answer">
                  <p>{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Support;
